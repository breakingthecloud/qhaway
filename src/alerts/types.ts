export type AlertMetric =
  | 'cost_per_user_per_day'
  | 'cost_per_model'
  | 'latency_p99'
  | 'error_rate'
  | 'tokens_per_session'
  | 'total_cost_per_day';

export type AlertCondition = '>' | '<' | '>=' | '<=';

export type AlertWindow = 'hour' | 'day' | 'week';

export type AlertChannelType = 'slack' | 'email' | 'webhook' | 'pagerduty' | 'console';

export interface AlertChannel {
  type: AlertChannelType;
  target?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  condition: AlertCondition;
  threshold: number;
  window: AlertWindow;
  groupBy?: string;
  channels: AlertChannel[];
  cooldownMinutes: number;
}

export interface AlertEvaluation {
  ruleId: string;
  ruleName: string;
  metric: AlertMetric;
  condition: AlertCondition;
  threshold: number;
  actual: number;
  groupValue?: string;
  window: AlertWindow;
  triggered: boolean;
  timestamp: string;
  message: string;
}

export interface AlertFired extends AlertEvaluation {
  channels: AlertChannel[];
}
