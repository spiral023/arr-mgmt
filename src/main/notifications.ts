import { Notification } from "electron";

export type NotificationPayload = {
  title: string;
  body: string;
};

export type NotificationAdapter = {
  show: (payload: NotificationPayload) => void;
};

export function createNotificationAdapter(): NotificationAdapter {
  return {
    show(payload) {
      if (!Notification.isSupported()) {
        return;
      }
      new Notification(payload).show();
    },
  };
}
