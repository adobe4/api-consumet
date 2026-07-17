import { useEffect, useRef, useState, useCallback } from 'react';
import { Audio, type AVPlaybackStatus } from 'expo-av';

interface Playhead {
  time: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
}

/**
 * Drives a playhead from an audio file. Audio position updates arrive only a
 * few times per second, so between updates we advance the time with a
 * requestAnimationFrame loop for a smooth ~60fps preview, re-syncing whenever a
 * real status update lands.
 */
export function usePlayhead(audioUri: string | null, duration: number): Playhead {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const soundRef = useRef<Audio.Sound | null>(null);
  const rafRef = useRef<number | null>(null);
  const baseTime = useRef(0); // audio position (s) at last sync
  const baseClock = useRef(0); // performance clock (ms) at last sync

  // (Re)load the sound whenever the audio source changes.
  useEffect(() => {
    let cancelled = false;
    setTime(0);
    setPlaying(false);
    if (!audioUri) return;

    Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
    Audio.Sound.createAsync({ uri: audioUri }, { shouldPlay: false }, onStatus)
      .then(({ sound }) => {
        if (cancelled) {
          sound.unloadAsync().catch(() => {});
          return;
        }
        soundRef.current = sound;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUri]);

  function onStatus(status: AVPlaybackStatus) {
    if (!status.isLoaded) return;
    baseTime.current = (status.positionMillis ?? 0) / 1000;
    baseClock.current = performance.now();
    if (status.didJustFinish) {
      setPlaying(false);
      setTime(duration);
    }
  }

  // rAF loop while playing.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      const elapsed = (performance.now() - baseClock.current) / 1000;
      const t = Math.min(duration, baseTime.current + elapsed);
      setTime(t);
      if (t >= duration) {
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, duration]);

  const play = useCallback(() => {
    const s = soundRef.current;
    if (!s) return;
    baseClock.current = performance.now();
    s.playAsync().catch(() => {});
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    soundRef.current?.pauseAsync().catch(() => {});
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, play, pause]);

  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, t);
    baseTime.current = clamped;
    baseClock.current = performance.now();
    setTime(clamped);
    soundRef.current?.setPositionAsync(Math.round(clamped * 1000)).catch(() => {});
  }, []);

  return { time, playing, play, pause, toggle, seek };
}
