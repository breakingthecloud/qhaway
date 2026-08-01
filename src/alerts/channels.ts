import type { AlertChannel, AlertFired, AlertRule, AlertWindow } from './types.js';

export interface AlertChannelPayload {
  text: string;
  title?: string;
  severity?: 'info' | 'warning' | 'critical';
  ruleId?: string;
  metric?: string;
  actual?: number;
  threshold?: number;
  timestamp?: string;
  [key: string]: unknown;
}

export interface AlertChannelSender {
  send(payload: AlertChannelPayload): Promise<void>;
  type: string;
}

export class SlackChannel implements AlertChannelSender {
  type = 'slack';

  constructor(private webhookUrl: string) {}

  async send(payload: AlertChannelPayload): Promise<void> {
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:warning: *${payload.title ?? 'Qhaway Alert'}*\n${payload.text}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Rule \`${payload.ruleId ?? '-'}\` · ${payload.metric ?? ''} ${payload.actual ?? ''} vs threshold ${payload.threshold ?? ''}`,
          },
        ],
      },
    ];

    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks, text: payload.text }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Slack webhook failed: ${res.status} ${body}`);
    }
  }
}

export class WebhookChannel implements AlertChannelSender {
  type = 'webhook';

  constructor(private url: string, private headers: Record<string, string> = {}) {}

  async send(payload: AlertChannelPayload): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Webhook failed: ${res.status} ${body}`);
    }
  }
}

export class EmailChannel implements AlertChannelSender {
  type = 'email';

  constructor(
    private from: string,
    private to: string,
    private opts: { apiUrl?: string; apiKey?: string } = {},
  ) {}

  async send(payload: AlertChannelPayload): Promise<void> {
    const apiUrl = this.opts.apiUrl ?? 'https://api.mailchannels.net/tx/v1/send';
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.opts.apiKey ? { 'x-api-key': this.opts.apiKey } : {}),
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: this.to }] }],
        from: { email: this.from },
        subject: payload.title ?? 'Qhaway Alert',
        content: [{ type: 'text/plain', value: payload.text }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Email failed: ${res.status} ${body}`);
    }
  }
}

export class PagerDutyChannel implements AlertChannelSender {
  type = 'pagerduty';

  constructor(private integrationKey: string, private apiUrl = 'https://events.pagerduty.com/v2/enqueue') {}

  async send(payload: AlertChannelPayload): Promise<void> {
    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing_key: this.integrationKey,
        event_action: 'trigger',
        payload: {
          summary: payload.title ?? payload.text,
          source: 'qhaway',
          severity: payload.severity ?? 'warning',
          custom_details: {
            rule_id: payload.ruleId,
            metric: payload.metric,
            actual: payload.actual,
            threshold: payload.threshold,
            timestamp: payload.timestamp,
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PagerDuty failed: ${res.status} ${body}`);
    }
  }
}

export class ConsoleChannel implements AlertChannelSender {
  type = 'console';

  async send(payload: AlertChannelPayload): Promise<void> {
    console.log(`[Qhaway Alert] ${payload.title ?? 'Alert'} — ${payload.text}`);
  }
}

export function buildChannel(channel: AlertChannel): AlertChannelSender {
  switch (channel.type) {
    case 'slack':
      if (!channel.target) throw new Error('Slack channel requires target (webhook URL)');
      return new SlackChannel(channel.target);
    case 'webhook':
      if (!channel.target) throw new Error('Webhook channel requires target (URL)');
      return new WebhookChannel(channel.target);
    case 'email':
      if (!channel.target) throw new Error('Email channel requires target (to address)');
      return new EmailChannel(channel.target.split('|')[0] ?? 'alerts@qhaway.dev', channel.target);
    case 'pagerduty':
      if (!channel.target) throw new Error('PagerDuty channel requires target (integration key)');
      return new PagerDutyChannel(channel.target);
    case 'console':
      return new ConsoleChannel();
    default:
      throw new Error(`Unknown channel type: ${(channel as AlertChannel).type}`);
  }
}

export interface CooldownEntry {
  lastFiredAt: number;
  fires: number;
}

export class CooldownTracker {
  private state = new Map<string, CooldownEntry>();

  constructor(private now: () => number = () => Date.now()) {}

  canFire(ruleId: string, groupValue: string | undefined, cooldownMinutes: number): boolean {
    const key = this.key(ruleId, groupValue);
    const entry = this.state.get(key);
    if (!entry) return true;
    const elapsed = this.now() - entry.lastFiredAt;
    return elapsed >= cooldownMinutes * 60 * 1000;
  }

  markFired(ruleId: string, groupValue: string | undefined): void {
    const key = this.key(ruleId, groupValue);
    const entry = this.state.get(key);
    this.state.set(key, {
      lastFiredAt: this.now(),
      fires: (entry?.fires ?? 0) + 1,
    });
  }

  getFireCount(ruleId: string, groupValue: string | undefined): number {
    return this.state.get(this.key(ruleId, groupValue))?.fires ?? 0;
  }

  private key(ruleId: string, groupValue: string | undefined): string {
    return groupValue ? `${ruleId}:${groupValue}` : ruleId;
  }
}

export function evaluateWindow(window: AlertWindow, now: Date = new Date()): Date {
  const ms =
    window === 'hour' ? 60 * 60 * 1000 :
    window === 'day' ? 24 * 60 * 60 * 1000 :
    7 * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}

export async function fireChannels(
  channels: AlertChannel[],
  payload: AlertChannelPayload,
  onError?: (err: unknown) => void,
): Promise<void> {
  await Promise.allSettled(
    channels.map(async (ch) => {
      try {
        const sender = buildChannel(ch);
        await sender.send(payload);
      } catch (err) {
        if (onError) onError(err);
      }
    }),
  );
}
