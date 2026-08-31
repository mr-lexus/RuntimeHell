import { z } from 'zod';
import { RuntimeIdSchema } from './run.js';

export const ThemeModeSchema = z.enum(['dark', 'light', 'system']);
export type ThemeMode = z.infer<typeof ThemeModeSchema>;

/** Built-in accents plus a validated six-digit custom CSS color. */
export const AccentPresetSchema = z.union([
  z.enum(['cyan', 'amber', 'silver', 'violet', 'magenta', 'green', 'orange', 'ruby']),
  z.string().regex(/^#[0-9a-fA-F]{6}$/, 'custom accent must be a six-digit hex color')
]);
export type AccentPreset = z.infer<typeof AccentPresetSchema>;

export const BackgroundPresetSchema = z.enum(['topology', 'signal', 'blueprint', 'off']);
export type BackgroundPreset = z.infer<typeof BackgroundPresetSchema>;

export const BackgroundIntensitySchema = z.enum(['low', 'standard', 'high']);
export type BackgroundIntensity = z.infer<typeof BackgroundIntensitySchema>;

export const MotionModeSchema = z.enum(['system', 'reduced', 'full']);
export type MotionMode = z.infer<typeof MotionModeSchema>;

export const DensitySchema = z.enum(['compact', 'comfortable']);
export type Density = z.infer<typeof DensitySchema>;

export const UiScaleSchema = z.union([z.literal(90), z.literal(100), z.literal(110)]);
export type UiScale = z.infer<typeof UiScaleSchema>;

export const EditorWordWrapSchema = z.enum(['off', 'on', 'wordWrapColumn', 'bounded']);
export type EditorWordWrap = z.infer<typeof EditorWordWrapSchema>;

export const EditorLineNumbersSchema = z.enum(['on', 'off', 'relative']);
export type EditorLineNumbers = z.infer<typeof EditorLineNumbersSchema>;

export const EditorRenderWhitespaceSchema = z.enum(['none', 'boundary', 'selection', 'all']);
export type EditorRenderWhitespace = z.infer<typeof EditorRenderWhitespaceSchema>;

export const EditorCursorStyleSchema = z.enum(['line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin']);
export type EditorCursorStyle = z.infer<typeof EditorCursorStyleSchema>;

export const DrawerTabSchema = z.enum(['console', 'inspector', 'analysis', 'packages', 'runtimes']);

const SessionTabSchema = z.object({ workspaceId: z.string().min(1), relPath: z.string().min(1) }).strict();

export const AppSettingsSchema = z
  .object({
    schemaVersion: z.literal(2),
    prefs: z
      .object({
        timeoutMs: z.number().int().positive(),
        autorun: z.boolean(),
        ignoreScripts: z.boolean(),
        defaultRuntime: RuntimeIdSchema
      })
      .strict(),
    appearance: z
      .object({
        theme: ThemeModeSchema,
        accent: AccentPresetSchema,
        background: BackgroundPresetSchema,
        intensity: BackgroundIntensitySchema,
        motion: MotionModeSchema,
        density: DensitySchema,
        uiScale: UiScaleSchema
      })
      .strict(),
    editor: z
      .object({
        fontSize: z.number().int().min(10).max(32).default(13),
        fontLigatures: z.boolean().default(true),
        tabSize: z.number().int().min(1).max(8).default(2),
        insertSpaces: z.boolean().default(true),
        wordWrap: EditorWordWrapSchema.default('off'),
        lineNumbers: EditorLineNumbersSchema.default('on'),
        minimap: z.boolean().default(false),
        folding: z.boolean().default(true),
        renderWhitespace: EditorRenderWhitespaceSchema.default('selection'),
        bracketPairColorization: z.boolean().default(true),
        smoothScrolling: z.boolean().default(true),
        stickyScroll: z.boolean().default(false),
        cursorStyle: EditorCursorStyleSchema.default('line'),
        inlineInspector: z.boolean().default(true),
        /** Opt-in modal Vim/Neovim-style editing layer for Monaco. */
        vimMode: z.boolean().default(false)
      })
      .strict(),
    layout: z
      .object({
        drawerOpen: z.boolean(),
        drawerRatio: z.number().min(0.08).max(0.85),
        drawerTab: DrawerTabSchema,
        inlineOutputWidth: z.number().int().min(180).max(720)
      })
      .strict(),
    session: z
      .object({
        tabs: z.array(SessionTabSchema),
        activeRelPath: z.string().nullable()
      })
      .strict()
  })
  .strict();
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const SettingsPatchSchema = z
  .object({
    prefs: AppSettingsSchema.shape.prefs.partial().optional(),
    appearance: AppSettingsSchema.shape.appearance.partial().optional(),
    editor: AppSettingsSchema.shape.editor.partial().optional(),
    layout: AppSettingsSchema.shape.layout.partial().optional(),
    session: AppSettingsSchema.shape.session.partial().optional()
  })
  .strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
