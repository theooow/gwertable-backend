/**
 * Retourne la clé de jour Paris (YYYY-MM-DD) pour une date UTC donnée.
 * Utilisé pour comparer si une tâche tombe le même jour qu'un événement.
 *
 * @param date - Date UTC à convertir
 */
export function getParisDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Échappe les caractères spéciaux d'une valeur texte pour le format ICS.
 *
 * @param value - Texte brut
 */
export function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");
}

/**
 * Formate une date en chaîne ICS (format UTC compact).
 *
 * @param date - Date à formater
 */
export function formatIcsDate(date: Date): string {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".000", "");
}

/**
 * Replie une ligne ICS à 74 caractères maximum selon la RFC 5545.
 *
 * @param line - Ligne à replier
 */
export function foldIcsLine(line: string): string {
  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > 74) {
    chunks.push(remaining.slice(0, 74));
    remaining = ` ${remaining.slice(74)}`;
  }
  chunks.push(remaining);
  return chunks.join("\r\n");
}

type CalendarTask = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  priority: string;
  dueAt: Date | null;
  assignee: { fullName: string } | null;
  assignees?: Array<{ person: { fullName: string } }>;
  updatedAt: Date;
};

/**
 * Génère le contenu d'un calendrier ICS à partir des tâches d'un événement.
 *
 * @param event - Événement avec ses tâches
 * @returns Contenu du fichier ICS (UTF-8)
 */
export function buildTasksCalendar(event: {
  id: string;
  name: string;
  tasks: CalendarTask[];
}): string {
  const now = formatIcsDate(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Abregi//Tasks//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
    `X-WR-CALNAME:${escapeIcsText(`Taches - ${event.name}`)}`,
  ];

  for (const task of event.tasks) {
    if (!task.dueAt) continue;
    const startsAt = task.dueAt;
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const description = [
      task.description,
      `Statut: ${task.status}`,
      `Priorite: ${task.priority}`,
      `Categorie: ${task.category}`,
      task.assignees && task.assignees.length > 0
        ? `Assignes a: ${task.assignees.map((item) => item.person.fullName).join(", ")}`
        : task.assignee ? `Assigne a: ${task.assignee.fullName}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:abregi-task-${task.id}@abregi`,
      `DTSTAMP:${now}`,
      `DTSTART:${formatIcsDate(startsAt)}`,
      `DTEND:${formatIcsDate(endsAt)}`,
      `LAST-MODIFIED:${formatIcsDate(task.updatedAt)}`,
      `SEQUENCE:${Math.floor(task.updatedAt.getTime() / 1000)}`,
      `SUMMARY:${escapeIcsText(task.title)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `CATEGORIES:${escapeIcsText(task.category)}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-P1D",
      `DESCRIPTION:${escapeIcsText(`Demain: ${task.title}`)}`,
      "END:VALARM",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:PT0S",
      `DESCRIPTION:${escapeIcsText(task.title)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
