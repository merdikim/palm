/** Navigation param lists + deep-link config. */
import type { NavigatorScreenParams } from '@react-navigation/native';

export type HomeStackParamList = {
  HomeMain: undefined;
};

export type AgentsStackParamList = {
  AgentsList: undefined;
  CreateVault: undefined;
  AgentDetail: { agent: string };
};

export type RequestsStackParamList = {
  RequestsList: { focusId?: string } | undefined;
};

export type TabParamList = {
  Home: NavigatorScreenParams<HomeStackParamList>;
  Agents: NavigatorScreenParams<AgentsStackParamList>;
  Requests: NavigatorScreenParams<RequestsStackParamList>;
};

export type RootParamList = {
  Onboarding: undefined;
  Tabs: NavigatorScreenParams<TabParamList>;
};

/**
 * Deep link config. A push tap carries `{ type, id }`; we route it to the
 * Requests tab, passing the opaque id through as `focusId`.
 *   palm://requests/<id>
 */
import type { LinkingOptions } from '@react-navigation/native';

export const linking: LinkingOptions<RootParamList> = {
  prefixes: ['palm://', 'https://palm.app'],
  config: {
    screens: {
      Tabs: {
        screens: {
          Requests: {
            screens: {
              RequestsList: 'requests/:focusId',
            },
          },
          Home: 'home',
          Agents: 'agents',
        },
      },
      Onboarding: 'onboarding',
    },
  },
};
