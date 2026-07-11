/**
 * Haven icon set — thin single-weight line icons drawn with react-native-svg.
 * Paths lifted 1:1 from the Haven design so the app matches it exactly.
 */
import React from 'react';
import Svg, { Path, Rect, Circle } from 'react-native-svg';

export type IconName =
  | 'shield'
  | 'shieldCheck'
  | 'lock'
  | 'unlock'
  | 'check'
  | 'home'
  | 'agents'
  | 'requests'
  | 'add'
  | 'send'
  | 'withdraw'
  | 'request'
  | 'in'
  | 'out'
  | 'agentGlyph'
  | 'w'
  | 'clock'
  | 'mailOpen'
  | 'swap'
  | 'wallet'
  | 'coins'
  | 'repeat';

export function Icon({
  name,
  size = 20,
  color = '#0B5C43',
  strokeWidth = 2,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const stroke = color;
  const common = {
    stroke,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };

  let body: React.ReactNode;
  switch (name) {
    case 'shield':
      body = <Path d="M12 3l7 3v5c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6l7-3z" {...common} />;
      break;
    case 'shieldCheck':
      body = (
        <>
          <Path d="M12 3l7 3v5c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6l7-3z" {...common} />
          <Path d="M9 11.8l2.1 2.1 4-4.2" {...common} />
        </>
      );
      break;
    case 'lock':
      body = (
        <>
          <Rect x={5} y={11} width={14} height={9} rx={2.5} {...common} />
          <Path d="M8 11V8a4 4 0 018 0v3" {...common} />
        </>
      );
      break;
    case 'unlock':
      body = (
        <>
          <Rect x={5} y={11} width={14} height={9} rx={2.5} {...common} />
          <Path d="M8 11V8a4 4 0 017.6-1.7" {...common} />
        </>
      );
      break;
    case 'check':
      body = <Path d="M5 12.5l4.5 4.5L19 7.5" {...common} />;
      break;
    case 'home':
      body = <Path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-5v-6h-4v6H5a1 1 0 01-1-1v-9z" {...common} />;
      break;
    case 'agents':
      body = <Path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12 12 3.5z" {...common} />;
      break;
    case 'requests':
      body = <Path d="M4 6.5h16v11.5a1 1 0 01-1 1H5a1 1 0 01-1-1V6.5zM4.5 8l7.5 5.5L19.5 8" {...common} />;
      break;
    case 'add':
      body = <Path d="M12 5v14M5 12h14" {...common} />;
      break;
    case 'send':
      body = <Path d="M7 17L17 7M9.5 7H17v7.5" {...common} />;
      break;
    case 'withdraw':
      body = <Path d="M12 4v10m-4.5-4.5L12 14l4.5-4.5M5 19.5h14" {...common} />;
      break;
    case 'request':
      body = <Path d="M17 7L7 17M14.5 17H7V9.5" {...common} />;
      break;
    case 'in':
      body = <Path d="M12 19V5M6 11l6-6 6 6" {...common} />;
      break;
    case 'out':
      body = <Path d="M12 5v14M6 13l6 6 6-6" {...common} />;
      break;
    case 'agentGlyph':
      body = <Path d="M12 4l8 8-8 8-8-8 8-8z" {...common} />;
      break;
    case 'w':
      body = <Path d="M12 4v10m-4-4l4 4 4-4M5 20h14" {...common} />;
      break;
    case 'clock':
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...common} />
          <Path d="M12 8v4.5l2.8 2" {...common} />
        </>
      );
      break;
    case 'mailOpen':
      body = (
        <>
          <Rect x={4} y={6} width={16} height={13} rx={2.5} {...common} />
          <Path d="M4.5 8l7.5 5.5L19.5 8" {...common} />
        </>
      );
      break;
    case 'swap':
      body = <Path d="M8 20V5M5 8l3-3 3 3M16 4v15M19 16l-3 3-3-3" {...common} />;
      break;
    case 'wallet':
      body = (
        <>
          <Rect x={3} y={6} width={18} height={13} rx={3} {...common} />
          <Path d="M16 11h5v4h-5a2 2 0 010-4z" {...common} />
        </>
      );
      break;
    case 'coins':
      body = (
        <>
          <Path d="M20 7c0 1.66-3.58 3-8 3S4 8.66 4 7s3.58-3 8-3 8 1.34 8 3z" {...common} />
          <Path d="M4 7v5c0 1.66 3.58 3 8 3s8-1.34 8-3V7" {...common} />
          <Path d="M4 12v5c0 1.66 3.58 3 8 3s8-1.34 8-3v-5" {...common} />
        </>
      );
      break;
    case 'repeat':
      body = <Path d="M17 3l3 3-3 3M20 6H9a5 5 0 00-5 5M7 21l-3-3 3-3M4 18h11a5 5 0 005-5" {...common} />;
      break;
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}
