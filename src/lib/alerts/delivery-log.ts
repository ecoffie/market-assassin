type AlertType = 'daily' | 'weekly';
type ProfileTable = 'user_notification_settings' | 'user_alert_settings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MinimalSupabaseClient = any;

interface PersistSentAlertParams {
  supabase: MinimalSupabaseClient;
  email: string;
  alertType: AlertType;
  opportunitiesCount: number;
  opportunitiesData?: Record<string, unknown>[];
  currentTotalAlertsSent?: number | null;
  lastAlertCount?: number;
  profileTable?: ProfileTable;
  sentAt?: string;
}

export async function persistSentAlert({
  supabase,
  email,
  alertType,
  opportunitiesCount,
  opportunitiesData,
  currentTotalAlertsSent,
  lastAlertCount,
  profileTable = 'user_notification_settings',
  sentAt = new Date().toISOString(),
}: PersistSentAlertParams): Promise<{ alertDate: string; sentAt: string }> {
  const alertDate = sentAt.split('T')[0];

  const alertLogPayload: Record<string, unknown> = {
    user_email: email,
    alert_date: alertDate,
    alert_type: alertType,
    opportunities_count: opportunitiesCount,
    sent_at: sentAt,
    delivery_status: 'sent',
  };

  if (opportunitiesData) {
    alertLogPayload.opportunities_data = opportunitiesData;
  }

  const { error: logError } = await supabase
    .from('alert_log')
    .upsert(alertLogPayload, { onConflict: 'user_email,alert_date,alert_type' });

  if (logError) {
    throw new Error(`Failed to write alert_log: ${logError.message}`);
  }

  const { data: verifiedLog, error: verifyError } = await supabase
    .from('alert_log')
    .select('id')
    .eq('user_email', email)
    .eq('alert_date', alertDate)
    .eq('alert_type', alertType)
    .maybeSingle();

  if (verifyError) {
    throw new Error(`Failed to verify alert_log write: ${verifyError.message}`);
  }

  if (!verifiedLog) {
    throw new Error('Alert log verification failed: row missing after upsert');
  }

  const profileUpdate: Record<string, unknown> = {
    last_alert_sent: sentAt,
    total_alerts_sent: (currentTotalAlertsSent ?? 0) + 1,
  };

  if (typeof lastAlertCount === 'number') {
    profileUpdate.last_alert_count = lastAlertCount;
  }

  const { error: profileError } = await supabase
    .from(profileTable)
    .update(profileUpdate)
    .eq('user_email', email);

  if (profileError) {
    throw new Error(`Failed to update ${profileTable}: ${profileError.message}`);
  }

  return { alertDate, sentAt };
}
