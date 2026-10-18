import { captureClientNavigation, initializeClientMonitoring } from './lib/monitoring/client';

initializeClientMonitoring();
export const onRouterTransitionStart = captureClientNavigation;
