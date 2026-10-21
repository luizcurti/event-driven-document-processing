export interface NotificationSender {
  send(payload: { documentId: string; message: string }): Promise<void>;
}
