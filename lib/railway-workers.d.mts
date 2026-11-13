export type RailwayConfig = {
  environment: 'dev' | 'staging' | 'production'; projectId: string; environmentId: string; convexUrl: string;
  region: 'us-east4-eqdc4a' | 'us-west2' | 'europe-west4-drams3a' | 'asia-southeast1-eqsg3a';
  processorImage?: string; exportsImage?: string; processorCommit?: string; exportsCommit?: string;
  processorServices: string[]; standardServices: string[]; ultraServices: string[]; distributedExports: boolean;
  artifactBucket?: string; artifactEndpoint?: string;
};
type Target = { token: string; config: RailwayConfig };
type Slot = Target & { serviceId: string };
export type Deployment = { id: string; status: string; deploymentStopped: boolean; meta: ({ commitHash?: string } & Record<string, unknown>) | null; createdAt?: string };
type Instance = {
  serviceId: string; serviceName: string; numReplicas: number | null; region: string | null;
  startCommand: string | null;
  restartPolicyType: string; sleepApplication: boolean | null;
  source: { image: string | null; repo: string | null } | null;
  latestDeployment: Deployment | null; activeDeployments: Deployment[];
};
export const RAILWAY_ENDPOINT: string;
export const RAILWAY_BUDGET: Readonly<{ vCPUs: 4; memoryGB: 8 }>;
export const RAILWAY_CPU_ENV: Readonly<Record<string, string>>;
export class RailwayRateLimitError extends Error { retryAfterMs: number; constructor(retryAfterMs: number); }
export function railwayConfig(raw: unknown): RailwayConfig;
export function railway(args: { token: string; query: string; variables?: Record<string, unknown> }): Promise<unknown>;
export function verifyRailwayTarget(args: Target): Promise<void>;
export function railwayInstance(args: Slot): Promise<Instance>;
export function railwayActive(instance: Instance): boolean;
export function verifyRailwaySlot(args: Slot & { image?: string }): Promise<Instance>;
export function configureRailwaySlot(args: Slot & { image?: string; variables: Record<string, string>; registryCredentials?: { username: string; password: string } }): Promise<void>;
export function deployRailwaySlot(args: Slot & { deployment?: Deployment | null }): Promise<string>;
export function railwayDeployments(args: Slot & { first?: number }): Promise<Deployment[]>;
export function railwayDeploymentCommit(deployment: Deployment | null | undefined): string | null;
export function railwayGoodDeployments(deployments: Deployment[], skip?: (deployment: Deployment) => boolean): Deployment[];
export function railwayGoodDeployment(deployments: Deployment[], skip?: (deployment: Deployment) => boolean): Deployment | null;
export function railwayBootCrashed(args: { token: string; deploymentId: string }): Promise<boolean>;
export function createRailwayService(args: Target & { name: string }): Promise<string>;
export function deleteRailwayService(args: Slot): Promise<void>;
export function reapRailwayServices(args: Target): Promise<void>;

export function railwayLogEvents(raw: unknown): Array<{ event: string; image?: string; commit?: string; role?: string; taskId?: string; projectId?: string; machines?: number; cpus?: number; memoryBytes?: number; environment?: string }>;
