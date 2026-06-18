export function getAutomationSafetyLimit(limit: number, stopAtPercent: number): number {
  return Math.floor((limit * stopAtPercent) / 100);
}

export function shouldStopForQuotaSafety(input: { used: number; limit: number; stopAtPercent: number }): boolean {
  return input.used >= getAutomationSafetyLimit(input.limit, input.stopAtPercent);
}

export function nextQuotaEligibleAt(now = new Date(), minimumDelayHours = 24): Date {
  return new Date(now.getTime() + minimumDelayHours * 60 * 60 * 1000);
}
