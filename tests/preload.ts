import { EnvVar } from "../src/config/env.ts";
import { LogLevel } from "../src/utils/logger.ts";

process.env[EnvVar.LogLevel] = LogLevel.Silent;
