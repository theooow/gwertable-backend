import { Prisma, type PrismaClient, type UsagePlan } from "@prisma/client";

const billingUser = {
  id: true,
  email: true,
  name: true,
  companyName: true,
  billingEmail: true,
  usagePlan: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  subscriptionStatus: true,
  subscriptionInterval: true,
  subscriptionPeriodEnd: true,
  subscriptionCancelAtPeriodEnd: true,
  trialStartedAt: true,
  trialEndsAt: true,
} satisfies Prisma.UserSelect;

export type BillingUser = Prisma.UserGetPayload<{ select: typeof billingUser }>;

export type SubscriptionState = {
  usagePlan: UsagePlan;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscriptionStatus: string;
  subscriptionInterval: string | null;
  subscriptionPeriodEnd: Date | null;
  subscriptionCancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  trialStartedAt?: Date;
};

export class BillingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findUser(id: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id }, select: billingUser });
  }

  findUserByCustomer(stripeCustomerId: string) {
    return this.prisma.user.findUnique({ where: { stripeCustomerId }, select: billingUser });
  }

  setCustomer(id: string, stripeCustomerId: string) {
    return this.prisma.user.update({ where: { id }, data: { stripeCustomerId } });
  }

  applySubscription(id: string, state: SubscriptionState) {
    return this.prisma.user.update({ where: { id }, data: state });
  }

  async isEventProcessed(id: string) {
    return (await this.prisma.stripeEvent.count({ where: { id } })) > 0;
  }

  async markEventProcessed(id: string, type: string) {
    try {
      await this.prisma.stripeEvent.create({ data: { id, type } });
    } catch (error) {
      // A concurrent delivery of the same event already recorded it.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
}
