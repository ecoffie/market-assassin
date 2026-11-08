import type { PushMessage } from './types';

/** Push copy for a delivered daily alert. Opens the Alerts panel on tap. */
export function dailyAlertMessage(count: number): PushMessage {
  return {
    title: count === 1 ? '🎯 1 new opportunity' : `🎯 ${count} new opportunities`,
    body: 'Your daily Mindy alert is ready — tap to review.',
    url: '/app?panel=alerts',
  };
}

