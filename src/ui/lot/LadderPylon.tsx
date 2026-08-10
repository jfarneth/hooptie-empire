import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Ellipse, G, Rect, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme';
import type { Camera } from './camera';
import { PYLON_RESERVE, type EnvironmentDef } from './environment';
import type { LotLayout } from './layout';

/**
 * The pylon sign at the right-hand end of the building: how close the business
 * is to the next store, standing on the lot rather than sitting in a menu.
 *
 * A dealership already has one of these — the tall sign by the road with the
 * name on it — so making it the progress readout costs the scene nothing and
 * puts the single most important number in the game where the player is already
 * looking. It reads as a fundraising thermometer on purpose: the cap names the
 * store you are saving for, the column fills with cash, and it turns green and
 * says READY the moment the cheque would clear.
 *
 * DRAWN OUTSIDE `LotGround`, and deliberately. The ground plate is memoised
 * because it is ~400 elements that must not redraw at 4Hz; this fills as cash
 * changes, so a gauge inside that memo would defeat the whole point of it. It is
 * a separate, tiny `Svg` layered on top, with pointer events off so the taps
 * still reach the sign target underneath — which already opens the ladder.
 *
 * Its footprint is `PYLON_RESERVE` wide and it rises out of the foot of the
 * building, so it never overlaps a stall: a vertical thing grows straight up the
 * screen under this camera and its base does not move.
 *
 * SHRINKS WITH THE SCENE, BUT NOT ALL THE WAY. Everything else on the lot is
 * scenery and scales with the camera; this is a readout, and a gauge that says
 * READY in four pixels says nothing. So it takes the camera's scale with a floor
 * under it — at a driveway it stands down and lets the house be the subject, and
 * at a premium franchise it stays legible over forty cars.
 */

interface Props {
  layout: LotLayout;
  camera: Camera;
  env: EnvironmentDef;
  /** Cash as a share of the next store's entry cost. Clamped here. */
  progress: number;
  /** Short name of the store being saved for. Ignored at the top of the ladder. */
  targetName: string;
  /** Nothing left to buy: the sign becomes a plaque rather than a gauge. */
  atTop: boolean;
}

export function LadderPylon({ layout, camera, env, progress, targetName, atTop }: Props) {
  const pct = Math.max(0, Math.min(1, progress));
  const ready = atTop || pct >= 1;

  // Roughly as tall as the building it stands beside, and never so short that
  // the gauge stops being readable on a driveway.
  const mast = camera.rise(env.buildingHeight * 0.95);
  const totalH = Math.max(66, mast + 14);
  const capH = 13;
  const gaugeH = Math.min(78, Math.max(40, totalH - 20));
  const postH = Math.max(10, totalH - gaugeH - capH);

  const boxW = PYLON_RESERVE - 10;
  const boxX = 5;
  const cx = boxX + boxW / 2;
  const gaugeTop = totalH - postH - gaugeH;
  const capTop = gaugeTop - capH;

  const inset = 3;
  const trackH = gaugeH - inset * 2;
  const fillH = trackH * (atTop ? 1 : pct);

  const capFill = ready ? theme.colors.money : (env.signColor ?? theme.colors.accent);
  const barFill = ready ? theme.colors.money : theme.colors.accent;
  const capText = atTop ? 'TOP' : targetName.toUpperCase();
  // Standing in the reserved strip at the right-hand end of the building band.
  const base = camera.project(layout.width - PYLON_RESERVE / 2, layout.showroomDepth);
  const k = Math.max(0.6, Math.min(1, camera.scale * 1.15));
  const readout = atTop ? '★' : ready ? 'READY' : `${Math.round(pct * 100)}%`;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.host,
        {
          left: base.x - PYLON_RESERVE / 2,
          // Scaled about its own centre, so this is what puts the foot of the
          // post back on the tarmac where the camera says it stands.
          top: base.y - (totalH * (1 + k)) / 2,
          transform: [{ scale: k }],
        },
      ]}
    >
      <Svg width={PYLON_RESERVE} height={totalH + 6}>
        {/* the post, standing on the tarmac at the foot of the building */}
        <Ellipse cx={cx} cy={totalH} rx={9} ry={2.6} fill="#000" opacity={0.45} />
        <Rect x={cx - 3.4} y={totalH - postH} width={6.8} height={postH} fill="#252b36" />
        <Rect x={cx - 3.4} y={totalH - postH} width={2.4} height={postH} fill="#3b4454" />

        {/* the gauge */}
        <Rect
          x={boxX}
          y={gaugeTop}
          width={boxW}
          height={gaugeH}
          rx={4}
          fill="#12161e"
          stroke="#3b4454"
          strokeWidth={1.4}
        />
        <Rect
          x={boxX + inset}
          y={gaugeTop + inset + (trackH - fillH)}
          width={boxW - inset * 2}
          height={fillH}
          rx={2}
          fill={barFill}
          opacity={0.85}
        />
        {/* Quarter marks, drawn only on the empty part of the column: over the
            fill they read as slats on a shutter rather than as a scale. */}
        {[0.25, 0.5, 0.75]
          .filter((f) => trackH * f > fillH + 1)
          .map((f) => (
            <Rect
              key={f}
              x={boxX + inset}
              y={gaugeTop + inset + trackH * (1 - f)}
              width={boxW - inset * 2}
              height={0.9}
              fill="#e9ecf3"
              opacity={0.22}
            />
          ))}

        {/* the readout, haloed because it sits half on the fill and half off it */}
        <G>
          <SvgText
            x={cx}
            y={gaugeTop + gaugeH / 2 + 3.5}
            fontSize={ready && !atTop ? 7 : 10}
            fontWeight="800"
            textAnchor="middle"
            fill="#0b0d11"
            stroke="#0b0d11"
            strokeWidth={2}
          >
            {readout}
          </SvgText>
          <SvgText
            x={cx}
            y={gaugeTop + gaugeH / 2 + 3.5}
            fontSize={ready && !atTop ? 7 : 10}
            fontWeight="800"
            textAnchor="middle"
            fill="#eef1f7"
          >
            {readout}
          </SvgText>
        </G>

        {/* the cap: whose name is on the sign you are working toward */}
        <Rect x={2} y={capTop} width={PYLON_RESERVE - 4} height={capH} rx={2.5} fill={capFill} />
        <SvgText
          x={PYLON_RESERVE / 2}
          y={capTop + capH / 2 + 2.6}
          fontSize={capText.length > 8 ? 5.6 : 6.6}
          fontWeight="800"
          textAnchor="middle"
          fill="#12151c"
          letterSpacing={0.3}
        >
          {capText}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute' },
});
