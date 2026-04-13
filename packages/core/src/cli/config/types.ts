import type { VelnAdapter } from '../../adapter/types'
import type { BoundVelnDB } from '../../db/index'

export interface VelnConfig {
  adapter?:    VelnAdapter
  features?:   string   // default: './src/features'
  schema?:     string   // default: './src/schema'
  tables?:     string   // default: './src/tables'
  migrations?: string   // default: './migrations'
  commands?:   string   // default: './src/commands'
}

export interface CommandOption {
  flag:        string
  description: string
  default?:    string
}

export interface CommandContext {
  db:      BoundVelnDB
  adapter: VelnAdapter
}

export interface CommandDef {
  _name:        string
  _description: string
  _options:     CommandOption[]
  _action:      (args: Record<string, string>, ctx: CommandContext) => Promise<void> | void
}

class CommandBuilder {
  private _desc = ''
  private _opts: CommandOption[] = []

  constructor(private readonly _name: string) {}

  description(desc: string): this {
    this._desc = desc
    return this
  }

  option(flag: string, description: string, defaultValue?: string): this {
    this._opts.push({ flag, description, default: defaultValue })
    return this
  }

  action(fn: (args: Record<string, string>, ctx: CommandContext) => Promise<void> | void): CommandDef {
    return {
      _name:        this._name,
      _description: this._desc,
      _options:     this._opts,
      _action:      fn,
    }
  }
}

export function defineConfig(config: VelnConfig): VelnConfig {
  return config
}

export function defineCommand(name: string): CommandBuilder {
  return new CommandBuilder(name)
}
