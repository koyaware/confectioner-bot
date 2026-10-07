import { Context, SessionFlavor } from 'grammy';
import { SessionData, SessionState } from '../types.js';
import { TelegramPort } from '../telegram/port.js';

export interface BotContext extends Context {
  tenant: {
    id: string;
    slug: string;
    botUsername: string;
    ownerTelegramId: number | null;
    shopName: string;
    currency: string;
    timezone: string;
    status: 'active' | 'paused';
    acceptOrders: boolean;
    greetingText: string | null;
    aboutText: string | null;
    contactsText: string | null;
    deliveryText: string | null;
    paymentText: string | null;
    busyText: string | null;
    replySlaText: string;
    prepaymentPercent: number;
    minLeadDays: number;
    maxAdvanceDays: number;
    defaultDailyCapacity: number;
    paymentDeadlineHours: number;
    deliveryFeeMinor: number;
    digestHour: number;
  };
  role: 'customer' | 'owner' | 'superadmin';
  session: SessionData;
  sessionState: SessionState;
  port: TelegramPort;
}

export type BotContextWithSession = BotContext & SessionFlavor<SessionData>;
