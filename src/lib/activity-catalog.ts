import type { UserRole } from "@prisma/client";
import { can, type Action } from "./permissions.js";

const typesByCategory = {
  event: ["EVENT_CREATED", "EVENT_UPDATED", "EVENT_DELETED", "EVENT_NOTIFICATIONS_UPDATED"],
  tasks: [
    "TASK_CREATED",
    "TASK_UPDATED",
    "TASK_STATUS_UPDATED",
    "TASK_COMMENT",
    "TASK_DUE_SOON",
    "TASK_DELETED",
    "TASK_CATEGORY_CREATED",
    "TASK_CATEGORY_UPDATED",
    "TASK_CATEGORY_DELETED",
    "TASK_ATTACHMENT_CREATED",
    "TASK_ATTACHMENT_DELETED",
  ],
  budget: [
    "EXPENSE_CREATED",
    "EXPENSE_UPDATED",
    "EXPENSE_DELETED",
    "EXPENSE_IMPORTED",
    "INCOME_CREATED",
    "INCOME_UPDATED",
    "INCOME_DELETED",
    "INCOME_IMPORTED",
    "TICKET_TIER_CREATED",
    "TICKET_TIER_UPDATED",
    "TICKET_TIER_DELETED",
    "TICKETING_SYNCED",
    "CONSUMABLE_CREATED",
    "CONSUMABLE_UPDATED",
    "CONSUMABLE_DELETED",
    "COLLECTIVE_CREATED",
    "COLLECTIVE_UPDATED",
    "COLLECTIVE_DELETED",
  ],
  shopping: ["SHOPPING_CREATED", "SHOPPING_UPDATED", "SHOPPING_BOUGHT", "SHOPPING_DELETED"],
  participants: [
    "PARTICIPANT_CREATED",
    "PARTICIPANT_UPDATED",
    "PARTICIPANT_DELETED",
    "COLLABORATOR_INVITED",
    "COLLABORATOR_REMOVED",
  ],
  runOfShow: [
    "RUN_OF_SHOW_CREATED",
    "RUN_OF_SHOW_UPDATED",
    "RUN_OF_SHOW_DELETED",
    "RUN_OF_SHOW_TRACK_CREATED",
    "RUN_OF_SHOW_TRACK_UPDATED",
    "RUN_OF_SHOW_TRACK_DELETED",
    "RUN_OF_SHOW_SECTION_CREATED",
    "RUN_OF_SHOW_SECTION_UPDATED",
    "RUN_OF_SHOW_SECTION_DELETED",
  ],
  equipment: [
    "EQUIPMENT_ADDED",
    "EQUIPMENT_UPDATED",
    "EQUIPMENT_REMOVED",
    "EQUIPMENT_IMPORTED",
    "EQUIPMENT_QUOTE_CREATED",
    "EQUIPMENT_QUOTE_UPDATED",
    "EQUIPMENT_QUOTE_DELETED",
    "EQUIPMENT_QUOTE_FILE_ATTACHED",
    "EQUIPMENT_ITEM_CREATED",
    "EQUIPMENT_ITEM_UPDATED",
    "EQUIPMENT_ITEM_DELETED",
    "EQUIPMENT_GROUP_CREATED",
    "EQUIPMENT_GROUP_UPDATED",
    "EQUIPMENT_GROUP_DELETED",
  ],
  volunteers: [
    "VOLUNTEER_APPLIED",
    "VOLUNTEER_APPLICATION_REVIEWED",
    "VOLUNTEER_FORM_UPDATED",
    "VOLUNTEER_SHIFT_CREATED",
    "VOLUNTEER_SHIFT_UPDATED",
    "VOLUNTEER_SHIFT_DELETED",
    "VOLUNTEER_ASSIGNMENTS_APPLIED",
    "VOLUNTEER_PLANNING_SENT",
    "VOLUNTEER_PLANNING_ANSWERED",
    "VOLUNTEER_SWAP_REQUESTED",
    "VOLUNTEER_CHECKED_IN",
    "VOLUNTEER_MEAL_CREATED",
    "VOLUNTEER_MEAL_UPDATED",
    "VOLUNTEER_MEAL_DELETED",
    "VOLUNTEER_CONTRACT_CREATED",
    "VOLUNTEER_CONTRACT_SENT",
    "VOLUNTEER_CONTRACT_SIGNED",
    "VOLUNTEER_CONTRACT_CANCELLED",
  ],
  people: [
    "PERSON_CREATED",
    "PERSON_UPDATED",
    "PERSON_ARCHIVED",
    "PERSON_RESTORED",
    "PERSON_DOCUMENT_ADDED",
    "PERSON_DOCUMENT_DELETED",
    "PERSON_NOTE_ADDED",
    "PERSON_NOTE_DELETED",
  ],
  team: ["WORKSPACE_UPDATED", "MEMBER_INVITED", "MEMBER_JOINED", "MEMBER_ROLE_UPDATED", "MEMBER_REMOVED"],
  accounting: ["FISCAL_YEAR_CREATED", "FISCAL_YEAR_UPDATED", "FISCAL_YEAR_DELETED", "FISCAL_YEAR_CLOSED"],
} as const;

export type ActivityCategory = keyof typeof typesByCategory;
export type ActivityNotificationType = (typeof typesByCategory)[ActivityCategory][number];
export type ActivityPreferenceKey =
  | "taskCommentsEnabled"
  | "taskDueSoonEnabled"
  | "budgetChangesEnabled"
  | "equipmentChangesEnabled"
  | "volunteerChangesEnabled";

// Object.keys loses the literal key types; typesByCategory is a non-empty const object.
export const activityCategories = Object.keys(typesByCategory) as [ActivityCategory, ...ActivityCategory[]];

const categoryPermission: Record<ActivityCategory, Action> = {
  event: "event.read",
  tasks: "task.read",
  budget: "budget.read",
  shopping: "shopping.read",
  participants: "participant.read",
  runOfShow: "runOfShow.read",
  equipment: "equipment.read",
  volunteers: "volunteer.manage",
  people: "person.read",
  team: "event.read",
  accounting: "finance.read",
};

const categoryPreference: Partial<Record<ActivityCategory, ActivityPreferenceKey>> = {
  tasks: "taskCommentsEnabled",
  budget: "budgetChangesEnabled",
  shopping: "budgetChangesEnabled",
  equipment: "equipmentChangesEnabled",
  volunteers: "volunteerChangesEnabled",
};

const categoryByType = new Map<string, ActivityCategory>(
  activityCategories.flatMap((category) => typesByCategory[category].map((type) => [type, category] as const)),
);

export function activityCategoryOf(type: string): ActivityCategory | null {
  return categoryByType.get(type) ?? null;
}

export function activityPreferenceOf(type: ActivityNotificationType): ActivityPreferenceKey | null {
  if (type === "TASK_DUE_SOON") return "taskDueSoonEnabled";
  const category = activityCategoryOf(type);
  return category ? categoryPreference[category] ?? null : null;
}

export function canSeeActivityCategory(role: UserRole, category: ActivityCategory) {
  return can(role, categoryPermission[category]);
}

export function visibleActivityTypes(role: UserRole, categories: readonly ActivityCategory[] = activityCategories): string[] {
  return categories
    .filter((category) => canSeeActivityCategory(role, category))
    .flatMap((category) => typesByCategory[category]);
}
