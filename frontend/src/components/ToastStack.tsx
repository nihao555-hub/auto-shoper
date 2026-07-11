import { CheckCircle, Info, Warning, X, XCircle } from "@phosphor-icons/react";
import type { ToastMessage } from "../types";

type ToastStackProps = {
  messages: ToastMessage[];
  onDismiss: (id: number) => void;
};

const iconByTone = {
  success: CheckCircle,
  warning: Warning,
  error: XCircle,
  info: Info,
};

export function ToastStack({ messages, onDismiss }: ToastStackProps) {
  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions">
      {messages.map((message) => {
        const Icon = iconByTone[message.tone];
        return (
          <div key={message.id} className={`toast toast-${message.tone}`}>
            <Icon size={21} weight="fill" />
            <div>
              <strong>{message.title}</strong>
              {message.detail ? <p>{message.detail}</p> : null}
            </div>
            <button
              type="button"
              className="toast-close"
              onClick={() => onDismiss(message.id)}
              aria-label="关闭通知"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
