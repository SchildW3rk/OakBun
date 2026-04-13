export type SqlType =
  | 'INTEGER'
  | 'TEXT'
  | 'REAL'
  | 'BOOLEAN'
  | 'TIMESTAMP'
  | 'JSON'
  | 'UUID'
  | 'BLOB'

export interface ColumnDef {
  type: SqlType
  nullable: boolean
  primaryKey: boolean
  autoIncrement: boolean
  unique: boolean
  defaultValue?: unknown
  defaultFn?: () => unknown
  /** Explicit SQL column name — overrides the JS key when set. */
  columnName?: string
}

export class Column<T> {
  // Phantom type — exists only at compile time, never assigned at runtime
  declare readonly _: T

  constructor(readonly def: Readonly<ColumnDef>) {}

  nullable(): Column<T | null> {
    return new Column<T | null>({ ...this.def, nullable: true })
  }

  primaryKey(): Column<T> {
    return new Column<T>({ ...this.def, primaryKey: true, autoIncrement: true })
  }

  unique(): Column<T> {
    return new Column<T>({ ...this.def, unique: true })
  }

  default(value: NonNullable<T>): Column<T> {
    return new Column<T>({ ...this.def, defaultValue: value })
  }

  defaultFn(fn: () => NonNullable<T>): Column<T> {
    return new Column<T>({ ...this.def, defaultFn: fn as () => unknown })
  }

  /**
   * Set an explicit SQL column name, independent of the JS property key.
   * Use this to map camelCase TypeScript keys to snake_case SQL columns.
   *
   * @example
   * passwordHash: column.text().name('password_hash')
   * // INSERT uses "password_hash", SELECT returns { passwordHash: ... }
   */
  name(columnName: string): Column<T> {
    return new Column<T>({ ...this.def, columnName })
  }
}

const base = (type: SqlType): ColumnDef => ({
  type,
  nullable: false,
  primaryKey: false,
  autoIncrement: false,
  unique: false,
})

export const column = {
  integer:   (): Column<number>     => new Column<number>({ ...base('INTEGER') }),
  text:      (): Column<string>     => new Column<string>({ ...base('TEXT') }),
  real:      (): Column<number>     => new Column<number>({ ...base('REAL') }),
  boolean:   (): Column<boolean>    => new Column<boolean>({ ...base('BOOLEAN') }),
  timestamp: (): Column<Date>       => new Column<Date>({ ...base('TIMESTAMP') }),
  uuid:      (): Column<string>     => new Column<string>({ ...base('UUID') }),
  blob:      (): Column<Uint8Array> => new Column<Uint8Array>({ ...base('BLOB') }),
  json:      <T = unknown>(): Column<T> => new Column<T>({ ...base('JSON') }),
}
