import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors, BorderRadius } from '../constants/theme';

interface ProgressBarProps {
  progress: number; // 0-1
  color?: string;
  height?: number;
}

export function ProgressBar({
  progress,
  color = Colors.primary,
  height = 8,
}: ProgressBarProps) {
  const clampedProgress = Math.min(Math.max(progress, 0), 1);

  return (
    <View style={[styles.track, { height }]}>
      <View
        style={[
          styles.fill,
          {
            width: `${clampedProgress * 100}%`,
            backgroundColor: color,
            height,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: Colors.border,
    borderRadius: BorderRadius.full,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: BorderRadius.full,
  },
});
