import type { UserRole } from "@prisma/client";

export const actions = {
  "event.read": ["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"],
  "event.write": ["ADMIN", "ORGANIZER"],
  "person.read": ["ADMIN", "ORGANIZER", "TREASURER"],
  "person.write": ["ADMIN", "ORGANIZER"],
  "participant.read": ["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"],
  "participant.write": ["ADMIN", "ORGANIZER"],
  "participant.sensitive": ["ADMIN", "ORGANIZER", "TREASURER"],
  "task.read": ["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"],
  "task.write": ["ADMIN", "ORGANIZER", "VOLUNTEER"],
  "budget.read": ["ADMIN", "ORGANIZER", "TREASURER"],
  "budget.write": ["ADMIN", "ORGANIZER", "TREASURER"],
  "shopping.read": ["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER"],
  "shopping.write": ["ADMIN", "ORGANIZER", "VOLUNTEER"],
  "runOfShow.read": ["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"],
  "runOfShow.write": ["ADMIN", "ORGANIZER", "VOLUNTEER"],
  "equipment.read": ["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"],
  "equipment.write": ["ADMIN", "ORGANIZER"],
  "announcement.read": ["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"],
  "announcement.write": ["ADMIN", "ORGANIZER"],
  "user.manage": ["ADMIN"],
} as const satisfies Record<string, readonly UserRole[]>;

export type Action = keyof typeof actions;

export function can(role: UserRole, action: Action): boolean {
  return (actions[action] as readonly string[]).includes(role);
}

export function requireCan(role: UserRole, action: Action): void {
  if (!can(role, action)) {
    const error = new Error("Acces refuse");
    error.name = "ForbiddenError";
    throw error;
  }
}
