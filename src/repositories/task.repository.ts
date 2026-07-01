import type { PrismaClient, Prisma, TaskStatus, Priority } from "@prisma/client";
import { NotFoundError } from "../lib/errors.js";
import { getParisDayKey } from "../lib/calendar.js";
import { TaskDao } from "../dao/task.dao.js";
import { TaskCalendarSubscriptionDao } from "../dao/task-calendar-subscription.dao.js";

type TaskInput = {
  title: string;
  description?: string | null;
  category: string;
  status: TaskStatus;
  priority: Priority;
  tags?: string[];
  checklist?: Prisma.InputJsonValue;
  dueAt?: string | null;
  assigneeId?: string | null;
};

/**
 * Synchronise l'élément du conducteur lié à une tâche dans une transaction.
 * Crée, met à jour ou supprime l'élément selon la date d'échéance et le jour de l'événement.
 *
 * @param tx - Client Prisma transactionnel
 * @param task - Données de la tâche après création/mise à jour
 */
async function syncRunOfShowItemForTask(
  tx: Prisma.TransactionClient,
  task: {
    id: string;
    eventId: string;
    title: string;
    description: string | null;
    dueAt: Date | null;
    assigneeId: string | null;
  },
) {
  const existing = await tx.runOfShowItem.findUnique({
    where: { sourceTaskId: task.id },
    select: { id: true },
  });

  if (!task.dueAt) {
    if (existing) await tx.runOfShowItem.delete({ where: { id: existing.id } });
    return null;
  }

  if (existing) {
    return tx.runOfShowItem.update({
      where: { id: existing.id },
      data: {
        startsAt: task.dueAt,
        title: task.title,
        responsiblePersonId: task.assigneeId,
        notes: task.description,
      },
      include: {
        responsiblePerson: { select: { id: true, fullName: true } },
        sourceTask: { select: { id: true, title: true } },
      },
    });
  }

  const event = await tx.event.findFirst({
    where: { id: task.eventId },
    select: { startsAt: true },
  });
  if (!event || getParisDayKey(event.startsAt) !== getParisDayKey(task.dueAt)) return null;

  return tx.runOfShowItem.create({
    data: {
      eventId: task.eventId,
      startsAt: task.dueAt,
      durationMin: 30,
      title: task.title,
      responsiblePersonId: task.assigneeId,
      notes: task.description,
      sourceTaskId: task.id,
    },
    include: {
      responsiblePerson: { select: { id: true, fullName: true } },
      sourceTask: { select: { id: true, title: true } },
    },
  });
}

/**
 * Repository pour le domaine tâche.
 * Orchestre le CRUD et la synchronisation bidirectionnelle avec le conducteur.
 */
export class TaskRepository {
  constructor(
    private readonly taskDao: TaskDao,
    private readonly subscriptionDao: TaskCalendarSubscriptionDao,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * Vérifie qu'un événement appartient à l'espace de travail.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'événement est introuvable
   */
  async assertEventInWorkspace(eventId: string, workspaceId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { id: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");
  }

  /**
   * Vérifie qu'une tâche appartient à l'espace de travail.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la tâche est introuvable
   */
  async assertTaskInWorkspace(id: string, workspaceId: string) {
    return this.taskDao.findByIdOrThrow(id, workspaceId);
  }

  /**
   * Vérifie qu'une personne appartient à l'espace de travail (si fournie).
   *
   * @param personId - Identifiant optionnel de la personne
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la personne est introuvable
   */
  async assertPersonIfProvided(personId: string | undefined | null, workspaceId: string) {
    if (!personId) return;
    const person = await this.prisma.person.findFirst({
      where: { id: personId, workspaceId },
      select: { id: true },
    });
    if (!person) throw new NotFoundError("Personne introuvable");
  }

  /**
   * Retourne les tâches d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listTasks(eventId: string, workspaceId: string) {
    return this.taskDao.findMany(eventId, workspaceId);
  }

  /**
   * Crée une tâche et synchronise l'élément du conducteur si applicable.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   * @returns `{ task, autoRunOfShowItem }` — l'élément du conducteur peut être `null`
   */
  async create(eventId: string, workspaceId: string, data: TaskInput) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    await this.assertPersonIfProvided(data.assigneeId, workspaceId);

    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          eventId,
          title: data.title,
          description: data.description || null,
          category: data.category,
          status: data.status,
          priority: data.priority,
          tags: data.tags ?? [],
          checklist: data.checklist ?? [],
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          assigneeId: data.assigneeId || null,
        },
        include: { assignee: { select: { id: true, fullName: true } } },
      });
      const autoRunOfShowItem = await syncRunOfShowItemForTask(tx, task);
      return { task, autoRunOfShowItem };
    });
  }

  /**
   * Met à jour une tâche et synchronise l'élément du conducteur.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de mise à jour
   * @throws {NotFoundError} Si la tâche est introuvable
   */
  async update(id: string, workspaceId: string, data: TaskInput) {
    await this.assertTaskInWorkspace(id, workspaceId);
    await this.assertPersonIfProvided(data.assigneeId, workspaceId);

    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description || null,
          category: data.category,
          status: data.status,
          priority: data.priority,
          tags: data.tags ?? [],
          checklist: data.checklist ?? [],
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          assigneeId: data.assigneeId || null,
        },
      });
      await syncRunOfShowItemForTask(tx, task);
      return task;
    });
  }

  /**
   * Met à jour uniquement le statut d'une tâche.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @param status - Nouveau statut
   * @throws {NotFoundError} Si la tâche est introuvable
   */
  async updateStatus(id: string, workspaceId: string, status: TaskStatus) {
    await this.assertTaskInWorkspace(id, workspaceId);
    return this.prisma.task.update({ where: { id }, data: { status } });
  }

  /**
   * Supprime une tâche et l'élément du conducteur lié si présent.
   *
   * @param id - Identifiant de la tâche
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si la tâche est introuvable
   */
  async delete(id: string, workspaceId: string) {
    await this.assertTaskInWorkspace(id, workspaceId);
    return this.prisma.$transaction(async (tx) => {
      const linked = await tx.runOfShowItem.findUnique({
        where: { sourceTaskId: id },
        select: { id: true },
      });
      if (linked) await tx.runOfShowItem.delete({ where: { id: linked.id } });
      return tx.task.delete({ where: { id } });
    });
  }

  /**
   * Retourne ou crée l'abonnement de calendrier ICS pour un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'événement est introuvable
   */
  async getCalendarSubscription(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.subscriptionDao.upsert(eventId);
  }

  /**
   * Retourne les données d'un événement pour la génération ICS.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'événement est introuvable
   */
  async findEventForCalendar(eventId: string, workspaceId: string) {
    const event = await this.taskDao.findEventForCalendar(eventId, workspaceId);
    if (!event) throw new NotFoundError("Evenement introuvable");
    return event;
  }

  /**
   * Retourne les données d'un événement via le token d'abonnement calendrier.
   *
   * @param token - Token d'abonnement
   * @throws {NotFoundError} Si l'abonnement est introuvable
   */
  async findEventForCalendarByToken(token: string) {
    const subscription = await this.subscriptionDao.findByToken(token);
    if (!subscription) throw new NotFoundError("Abonnement calendrier introuvable");
    return this.findEventForCalendar(subscription.eventId, subscription.event.workspaceId);
  }
}
