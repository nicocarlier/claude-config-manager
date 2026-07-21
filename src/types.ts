/** Whether a file is the user's own (editable) or a git-tracked repo file. */
export type Scope = 'personal' | 'shared';

/** Recognized Claude config file kinds. */
export type FileType =
  | 'instructions'
  | 'settings'
  | 'skills'
  | 'agents'
  | 'commands'
  | 'memory';

/** A single discovered config file. */
export interface FileEntry {
  path: string;
  name: string;
  rel: string;
  type: FileType;
  size: number;
  mtime: string | null;
  flags: string[];
  scope?: Scope;
  repo?: string | null;
}

/** Files of one type within a context. */
export interface Group {
  type: FileType;
  label: string;
  files: FileEntry[];
}

export type ContextKind = 'globals' | 'project';

/** A location whose config is shown as a tab: Globals or a project. */
export interface Context {
  id: string;
  label: string;
  root: string;
  kind: ContextKind;
  groups: Group[];
  summary?: { personal: number; shared: number };
  repos?: string[];
}

export interface Discovery {
  contexts: Context[];
  generatedAt?: string;
}
