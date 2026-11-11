import type { WithoutSystemFields } from 'convex/server';
import type { Doc, TableNames } from '../_generated/dataModel';

type NoExtra<Shape, Value> = Value & { [Key in Exclude<keyof Value, keyof Shape>]: never };

/** A row for `ctx.db.insert` built from a wider object (function arguments, another document). TypeScript accepts
 * an object with extra fields wherever a narrower one is expected, so `{ ...args }` compiles and then fails the
 * table's validator at run time. Through this, an extra field is a compile error.
 * `ctx.db.insert('assistantQueue', tableRow<'assistantQueue'>()({ ...context, createdAt }))` */
export const tableRow = <Table extends TableNames>() =>
  <Value extends WithoutSystemFields<Doc<Table>>>(value: NoExtra<WithoutSystemFields<Doc<Table>>, Value>): WithoutSystemFields<Doc<Table>> => value;

/** The same for `ctx.db.patch`: every field must exist on the table. */
export const tablePatch = <Table extends TableNames>() =>
  <Value extends Partial<WithoutSystemFields<Doc<Table>>>>(value: NoExtra<Partial<WithoutSystemFields<Doc<Table>>>, Value>): Partial<WithoutSystemFields<Doc<Table>>> => value;
