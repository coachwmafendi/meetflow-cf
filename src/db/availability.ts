import type { AvailabilityRuleRow } from "../types";

export async function listRules(db: D1Database, userId: number): Promise<AvailabilityRuleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM availability_rules
       WHERE user_id = ? AND is_active = 1
       ORDER BY day_of_week, start_time`,
    )
    .bind(userId)
    .all<AvailabilityRuleRow>();
  return results;
}

export async function listRulesForDay(
  db: D1Database,
  userId: number,
  dayOfWeek: number,
): Promise<AvailabilityRuleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM availability_rules
       WHERE user_id = ? AND day_of_week = ? AND is_active = 1
       ORDER BY start_time`,
    )
    .bind(userId, dayOfWeek)
    .all<AvailabilityRuleRow>();
  return results;
}

export interface RuleInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/** Replaces the host's entire weekly set atomically (ERD.md §12). */
export async function replaceRules(
  db: D1Database,
  userId: number,
  rules: RuleInput[],
  now: string,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM availability_rules WHERE user_id = ?").bind(userId),
  ];
  for (const rule of rules) {
    statements.push(
      db
        .prepare(
          `INSERT INTO availability_rules (user_id, day_of_week, start_time, end_time, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(userId, rule.dayOfWeek, rule.startTime, rule.endTime, now, now),
    );
  }
  await db.batch(statements);
}
