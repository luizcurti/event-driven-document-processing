import { NotificationSender } from "../ports/notification-sender";

export class SendNotificationUseCase {
  constructor(private readonly sender: NotificationSender) {}

  execute(payload: { documentId: string; message: string }): Promise<void> {
    return this.sender.send(payload);
  }
}
