import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Services required to publish the plugin-owned QR image. */
export declare const inject: string[];
/** Credentials displayed after the authenticated browser opens the QR dialog. */
export interface Config {
    /** Basic Auth username. */
    username: string;
    /** Basic Auth password. */
    password: string;
}
/** Required runtime-only credentials; the bundle patch reads them from environment variables. */
export declare const Config: z<Config>;
/** Register the plugin-owned QR image route used by the browser half. */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map