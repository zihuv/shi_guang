import {
  FastForward,
  FileWarning,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Rewind,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const SKIP_SECONDS = 5;
const HOVER_PREVIEW_DELAY_MS = 90;
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

type VideoPlayerVariant = "detail" | "preview";
type VideoFitMode = "contain" | "cover";

interface InitialVideoPlaybackState {
  currentTime: number;
  duration: number;
  isMuted: boolean;
  isPlaying: boolean;
  playbackRate: number;
  volume: number;
}

export interface VideoPlaybackSnapshot {
  currentTime: number;
  duration: number;
  isMuted: boolean;
  isPlaying: boolean;
  playbackRate: number;
  volume: number;
}

interface VideoPlayerProps {
  autoPlay?: boolean;
  className?: string;
  fit?: VideoFitMode;
  initialCurrentTime?: number;
  initialDuration?: number;
  initialIsMuted?: boolean;
  initialIsPlaying?: boolean;
  initialPlaybackRate?: number;
  initialVolume?: number;
  isFullscreen?: boolean;
  onPlaybackSnapshotChange?: (snapshot: VideoPlaybackSnapshot) => void;
  onToggleFullscreen?: () => void;
  poster?: string;
  src: string;
  variant?: VideoPlayerVariant;
}

function formatVideoTime(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function clampTime(value: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return Math.max(0, value);
  }

  return Math.max(0, Math.min(duration, value));
}

export function VideoPlayer({
  autoPlay = false,
  className,
  fit = "contain",
  initialCurrentTime = 0,
  initialDuration = 0,
  initialIsMuted = false,
  initialIsPlaying = false,
  initialPlaybackRate = 1,
  initialVolume = 1,
  isFullscreen = false,
  onPlaybackSnapshotChange,
  onToggleFullscreen,
  poster,
  src,
  variant = "preview",
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hoverVideoRef = useRef<HTMLVideoElement | null>(null);
  const hoverCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverPreviewTimerRef = useRef<number | null>(null);
  const hoverPreviewTargetRef = useRef<number | null>(null);
  const latestDurationRef = useRef(initialDuration);
  const onPlaybackSnapshotChangeRef = useRef(onPlaybackSnapshotChange);
  const initialPlaybackSourceRef = useRef(src);
  const initialPlaybackStateRef = useRef<InitialVideoPlaybackState>({
    currentTime: initialCurrentTime,
    duration: initialDuration,
    isMuted: initialIsMuted,
    isPlaying: initialIsPlaying,
    playbackRate: initialPlaybackRate,
    volume: initialVolume,
  });
  const initialSeekAppliedRef = useRef(false);
  const wasPlayingBeforeSeekRef = useRef(false);

  if (initialPlaybackSourceRef.current !== src) {
    initialPlaybackSourceRef.current = src;
    initialPlaybackStateRef.current = {
      currentTime: initialCurrentTime,
      duration: initialDuration,
      isMuted: initialIsMuted,
      isPlaying: initialIsPlaying,
      playbackRate: initialPlaybackRate,
      volume: initialVolume,
    };
  }
  onPlaybackSnapshotChangeRef.current = onPlaybackSnapshotChange;

  const [currentTime, setCurrentTime] = useState(initialCurrentTime);
  const [duration, setDuration] = useState(initialDuration);
  const [isPlaying, setIsPlaying] = useState(initialIsPlaying);
  const [isMuted, setIsMuted] = useState(initialIsMuted);
  const [playbackRate, setPlaybackRate] = useState(initialPlaybackRate);
  const [volume, setVolume] = useState(initialVolume);
  const [hasVideoError, setHasVideoError] = useState(false);
  const [isHoverPreviewMounted, setIsHoverPreviewMounted] = useState(false);
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [timeInputValue, setTimeInputValue] = useState(() =>
    String(Math.floor(initialCurrentTime)),
  );
  const [hoverState, setHoverState] = useState<{
    active: boolean;
    left: number;
    time: number;
    thumbnailSrc: string;
  }>({
    active: false,
    left: 0,
    time: 0,
    thumbnailSrc: "",
  });
  latestDurationRef.current = duration;

  const progressPercent = useMemo(() => {
    if (!Number.isFinite(duration) || duration <= 0) {
      return 0;
    }

    return Math.min(100, Math.max(0, (currentTime / duration) * 100));
  }, [currentTime, duration]);

  const clearHoverPreviewTimer = useCallback(() => {
    if (hoverPreviewTimerRef.current === null) {
      return;
    }

    window.clearTimeout(hoverPreviewTimerRef.current);
    hoverPreviewTimerRef.current = null;
  }, []);

  useEffect(() => clearHoverPreviewTimer, [clearHoverPreviewTimer]);

  useLayoutEffect(
    () => () => {
      const video = videoRef.current;
      if (!video) {
        return;
      }

      onPlaybackSnapshotChangeRef.current?.({
        currentTime: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : latestDurationRef.current,
        isMuted: video.muted,
        isPlaying: !video.paused,
        playbackRate: video.playbackRate,
        volume: video.volume,
      });
    },
    [src],
  );

  useEffect(() => {
    const initialPlaybackState = initialPlaybackStateRef.current;
    initialSeekAppliedRef.current = false;
    setCurrentTime(initialPlaybackState.currentTime);
    setDuration(initialPlaybackState.duration);
    setIsPlaying(initialPlaybackState.isPlaying);
    setIsMuted(initialPlaybackState.isMuted);
    setPlaybackRate(initialPlaybackState.playbackRate);
    setVolume(initialPlaybackState.volume);
    setHasVideoError(false);
    setIsEditingTime(false);
    setTimeInputValue(String(Math.floor(initialPlaybackState.currentTime)));
    setHoverState({ active: false, left: 0, time: 0, thumbnailSrc: "" });
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.volume = volume;
  }, [volume]);

  const emitPlaybackSnapshot = useCallback(
    (overrides: Partial<VideoPlaybackSnapshot> = {}) => {
      const video = videoRef.current;
      onPlaybackSnapshotChange?.({
        currentTime: overrides.currentTime ?? video?.currentTime ?? currentTime,
        duration:
          overrides.duration ??
          (video && Number.isFinite(video.duration) ? video.duration : duration),
        isMuted: overrides.isMuted ?? video?.muted ?? isMuted,
        isPlaying: overrides.isPlaying ?? (video ? !video.paused : isPlaying),
        playbackRate: overrides.playbackRate ?? video?.playbackRate ?? playbackRate,
        volume: overrides.volume ?? video?.volume ?? volume,
      });
    },
    [currentTime, duration, isMuted, isPlaying, onPlaybackSnapshotChange, playbackRate, volume],
  );

  const applyInitialVideoState = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const initialPlaybackState = initialPlaybackStateRef.current;
    video.muted = initialPlaybackState.isMuted;
    video.playbackRate = initialPlaybackState.playbackRate;
    video.volume = initialPlaybackState.volume;

    const targetInitialTime = clampTime(initialPlaybackState.currentTime, video.duration);
    if (
      targetInitialTime > 0 &&
      (!initialSeekAppliedRef.current || Math.abs(video.currentTime - targetInitialTime) > 0.25)
    ) {
      video.currentTime = targetInitialTime;
      setCurrentTime(targetInitialTime);
      setTimeInputValue(String(Math.floor(targetInitialTime)));
      initialSeekAppliedRef.current = Math.abs(video.currentTime - targetInitialTime) <= 0.25;
    }

    onPlaybackSnapshotChangeRef.current?.({
      currentTime: targetInitialTime > 0 ? targetInitialTime : video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : initialPlaybackState.duration,
      isMuted: video.muted,
      isPlaying: !video.paused,
      playbackRate: video.playbackRate,
      volume: video.volume,
    });

    if (autoPlay || initialPlaybackState.isPlaying) {
      void video.play().catch((error) => {
        console.error("Failed to resume video:", error);
      });
    }
  }, [autoPlay]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | null = null;

    const applyWhenReady = () => {
      if (disposed) {
        return;
      }

      const video = videoRef.current;
      if (video && video.readyState >= 1) {
        applyInitialVideoState();
        window.setTimeout(() => {
          if (!disposed) {
            applyInitialVideoState();
          }
        }, 100);
        window.setTimeout(() => {
          if (!disposed) {
            applyInitialVideoState();
          }
        }, 300);
        return;
      }

      retryTimer = window.setTimeout(applyWhenReady, 50);
    };

    applyWhenReady();

    return () => {
      disposed = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [applyInitialVideoState, src]);

  const updateDuration = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const nextDuration = Number.isFinite(video.duration) ? video.duration : 0;
    setDuration(nextDuration);
    emitPlaybackSnapshot({ currentTime, duration: nextDuration });
  }, [currentTime, emitPlaybackSnapshot]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (video.paused) {
      void video.play().catch((error) => {
        console.error("Failed to play video:", error);
      });
      return;
    }

    video.pause();
  }, []);

  const seekTo = useCallback(
    (nextTime: number) => {
      const video = videoRef.current;
      if (!video) {
        return;
      }

      const nextCurrentTime = clampTime(nextTime, video.duration);
      video.currentTime = nextCurrentTime;
      setCurrentTime(nextCurrentTime);
      emitPlaybackSnapshot({ currentTime: nextCurrentTime });
    },
    [emitPlaybackSnapshot],
  );

  const skipBy = useCallback(
    (offset: number) => {
      const video = videoRef.current;
      if (!video) {
        return;
      }

      seekTo(video.currentTime + offset);
    },
    [seekTo],
  );

  const handleScrubStart = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    wasPlayingBeforeSeekRef.current = !video.paused;
    video.pause();
  }, []);

  const handleScrubEnd = useCallback(() => {
    if (!wasPlayingBeforeSeekRef.current) {
      return;
    }

    wasPlayingBeforeSeekRef.current = false;
    void videoRef.current?.play().catch((error) => {
      console.error("Failed to resume video:", error);
    });
  }, []);

  const toggleMuted = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const nextMuted = !video.muted;
    const nextVolume = !nextMuted && video.volume <= 0 ? 0.5 : video.volume;

    video.volume = nextVolume;
    video.muted = nextMuted;
    setVolume(nextVolume);
    setIsMuted(video.muted);
    emitPlaybackSnapshot({ isMuted: video.muted, volume: nextVolume });
  }, [emitPlaybackSnapshot]);

  const setVideoVolume = useCallback(
    (nextVolume: number) => {
      const video = videoRef.current;
      const clampedVolume = Math.max(0, Math.min(1, nextVolume));
      const nextMuted = clampedVolume <= 0;

      if (video) {
        video.volume = clampedVolume;
        video.muted = nextMuted ? true : false;
      }

      setVolume(clampedVolume);
      setIsMuted(nextMuted);
      emitPlaybackSnapshot({ isMuted: nextMuted, volume: clampedVolume });
    },
    [emitPlaybackSnapshot],
  );

  const setVideoPlaybackRate = useCallback(
    (nextPlaybackRate: number) => {
      const video = videoRef.current;
      if (video) {
        video.playbackRate = nextPlaybackRate;
      }

      setPlaybackRate(nextPlaybackRate);
      emitPlaybackSnapshot({ playbackRate: nextPlaybackRate });
    },
    [emitPlaybackSnapshot],
  );

  const commitTimeInput = useCallback(() => {
    const nextTime = Number.parseFloat(timeInputValue);
    if (Number.isFinite(nextTime)) {
      seekTo(nextTime);
    }

    setIsEditingTime(false);
  }, [seekTo, timeInputValue]);

  const focusPlayer = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;

      if (
        target &&
        target !== event.currentTarget &&
        ["BUTTON", "INPUT", "SELECT"].includes(target.tagName)
      ) {
        event.stopPropagation();
        return;
      }

      switch (event.key) {
        case " ":
        case "Enter":
        case "k":
        case "K":
          event.preventDefault();
          event.stopPropagation();
          togglePlay();
          break;
        case "ArrowLeft":
          event.preventDefault();
          event.stopPropagation();
          skipBy(-SKIP_SECONDS);
          break;
        case "ArrowRight":
          event.preventDefault();
          event.stopPropagation();
          skipBy(SKIP_SECONDS);
          break;
        case "m":
        case "M":
          event.preventDefault();
          event.stopPropagation();
          toggleMuted();
          break;
      }
    },
    [skipBy, toggleMuted, togglePlay],
  );

  const captureHoverThumbnail = useCallback((time: number) => {
    const hoverVideo = hoverVideoRef.current;
    if (!hoverVideo || !Number.isFinite(time) || time < 0) {
      return;
    }

    hoverPreviewTargetRef.current = time;

    if (hoverVideo.readyState === 0) {
      return;
    }

    try {
      hoverVideo.currentTime = clampTime(time, hoverVideo.duration);
    } catch (error) {
      console.error("Failed to seek hover preview:", error);
    }
  }, []);

  const scheduleHoverThumbnail = useCallback(
    (time: number) => {
      clearHoverPreviewTimer();
      hoverPreviewTimerRef.current = window.setTimeout(() => {
        hoverPreviewTimerRef.current = null;
        captureHoverThumbnail(time);
      }, HOVER_PREVIEW_DELAY_MS);
    },
    [captureHoverThumbnail, clearHoverPreviewTimer],
  );

  const handleProgressPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const hoverTime = duration * ratio;
      const hoverLeft = ratio * 100;

      setIsHoverPreviewMounted(true);
      setHoverState((current) => ({
        ...current,
        active: true,
        left: hoverLeft,
        time: hoverTime,
      }));
      scheduleHoverThumbnail(hoverTime);
    },
    [duration, scheduleHoverThumbnail],
  );

  const handleProgressPointerLeave = useCallback(() => {
    clearHoverPreviewTimer();
    setIsHoverPreviewMounted(false);
    setHoverState((current) => ({ ...current, active: false, thumbnailSrc: "" }));
  }, [clearHoverPreviewTimer]);

  const handleHoverPreviewMetadata = useCallback(() => {
    const targetTime = hoverPreviewTargetRef.current;
    if (targetTime !== null) {
      captureHoverThumbnail(targetTime);
    }
  }, [captureHoverThumbnail]);

  const handleHoverPreviewSeeked = useCallback(() => {
    const hoverVideo = hoverVideoRef.current;
    if (!hoverVideo || hoverVideo.videoWidth <= 0 || hoverVideo.videoHeight <= 0) {
      return;
    }

    const targetTime = hoverPreviewTargetRef.current;
    if (targetTime !== null && Math.abs(hoverVideo.currentTime - targetTime) > 0.35) {
      return;
    }

    const canvas = hoverCanvasRef.current ?? document.createElement("canvas");
    hoverCanvasRef.current = canvas;
    const width = 176;
    const height = Math.max(
      1,
      Math.round((hoverVideo.videoHeight / hoverVideo.videoWidth) * width),
    );
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    try {
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(hoverVideo, 0, 0, width, height);

      setHoverState((current) => ({
        ...current,
        thumbnailSrc: canvas.toDataURL("image/jpeg", 0.72),
      }));
    } catch (error) {
      console.error("Failed to render hover preview:", error);
    }
  }, []);

  const progressStyle = {
    background: `linear-gradient(to right, rgb(59 130 246) 0%, rgb(59 130 246) ${progressPercent}%, rgba(255,255,255,0.28) ${progressPercent}%, rgba(255,255,255,0.28) 100%)`,
  };
  const isDetail = variant === "detail";

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={cn(
        "group relative h-full w-full overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
        className,
      )}
      data-video-player
      onKeyDown={handleKeyDown}
      onMouseDown={focusPlayer}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        poster={poster || undefined}
        muted={isMuted}
        onClick={togglePlay}
        onDurationChange={updateDuration}
        onLoadedMetadata={() => {
          updateDuration();
          applyInitialVideoState();
        }}
        onError={() => {
          setHasVideoError(true);
          setIsPlaying(false);
          emitPlaybackSnapshot({ isPlaying: false });
        }}
        onPause={() => {
          setIsPlaying(false);
          emitPlaybackSnapshot({ isPlaying: false });
        }}
        onPlay={() => {
          setIsPlaying(true);
          emitPlaybackSnapshot({ isPlaying: true });
        }}
        onTimeUpdate={(event) => {
          const nextCurrentTime = event.currentTarget.currentTime;
          setCurrentTime(nextCurrentTime);
          if (!isEditingTime) {
            setTimeInputValue(String(Math.floor(nextCurrentTime)));
          }
          emitPlaybackSnapshot({ currentTime: nextCurrentTime });
        }}
        className={cn(
          "h-full w-full bg-black",
          fit === "cover" ? "object-cover" : "object-contain",
        )}
      />
      {isHoverPreviewMounted && (
        <video
          ref={hoverVideoRef}
          src={src}
          muted
          playsInline
          preload="metadata"
          className="hidden"
          onLoadedMetadata={handleHoverPreviewMetadata}
          onError={() => setHoverState((current) => ({ ...current, thumbnailSrc: "" }))}
          onSeeked={handleHoverPreviewSeeked}
        />
      )}

      {hasVideoError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black text-white/75">
          <FileWarning className="h-10 w-10" />
          <span className="text-[13px] font-medium">视频加载失败</span>
        </div>
      )}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/82 via-black/56 to-transparent text-white transition-opacity duration-150",
          isPlaying ? "opacity-0 group-hover:opacity-100" : "opacity-100",
        )}
        data-video-controls
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={cn(
            "flex flex-col",
            isDetail ? "gap-1 px-2.5 pb-2 pt-2" : "gap-1 px-4 pb-2 pt-2",
          )}
        >
          <div
            className="relative flex h-3 items-center"
            onPointerMove={handleProgressPointerMove}
            onPointerLeave={handleProgressPointerLeave}
          >
            {hoverState.active && (
              <div
                className="pointer-events-none absolute bottom-7 z-10 flex -translate-x-1/2 flex-col items-center gap-1"
                style={{ left: `${hoverState.left}%` }}
              >
                {hoverState.thumbnailSrc && (
                  <img
                    src={hoverState.thumbnailSrc}
                    alt=""
                    className="max-h-24 w-44 rounded-md bg-black object-contain shadow-lg ring-1 ring-white/15"
                  />
                )}
                <span className="rounded-full bg-black/75 px-2 py-1 text-[11px] font-medium text-white shadow-sm ring-1 ring-white/10">
                  {formatVideoTime(hoverState.time)}
                </span>
              </div>
            )}

            <input
              type="range"
              min="0"
              max={duration || 0}
              step="0.01"
              value={currentTime}
              disabled={!duration}
              onPointerDown={handleScrubStart}
              onPointerUp={handleScrubEnd}
              onChange={(event) => seekTo(Number(event.currentTarget.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-primary-500 disabled:cursor-default disabled:opacity-50 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
              style={progressStyle}
              aria-label="播放进度"
            />
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={togglePlay}
                className={cn(
                  "flex items-center justify-center rounded-full bg-white/12 text-white/90 transition hover:bg-white/18 hover:text-white",
                  "size-7",
                )}
                title={isPlaying ? "暂停" : "播放"}
                aria-label={isPlaying ? "暂停" : "播放"}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => skipBy(-SKIP_SECONDS)}
                className={cn(
                  "flex items-center justify-center rounded-full bg-white/12 text-white/85 transition hover:bg-white/18 hover:text-white",
                  "size-7",
                )}
                title="后退 5 秒"
                aria-label="后退 5 秒"
              >
                <Rewind className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => skipBy(SKIP_SECONDS)}
                className={cn(
                  "flex items-center justify-center rounded-full bg-white/12 text-white/85 transition hover:bg-white/18 hover:text-white",
                  "size-7",
                )}
                title="前进 5 秒"
                aria-label="前进 5 秒"
              >
                <FastForward className="h-4 w-4" />
              </button>
              <div
                className={cn(
                  "ml-1 flex items-center whitespace-nowrap tabular-nums text-white/78",
                  isDetail ? "text-[11px]" : "text-[12px]",
                )}
              >
                {isEditingTime ? (
                  <input
                    value={timeInputValue}
                    onChange={(event) => setTimeInputValue(event.currentTarget.value)}
                    onBlur={commitTimeInput}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        commitTimeInput();
                      } else if (event.key === "Escape") {
                        setIsEditingTime(false);
                        setTimeInputValue(String(Math.floor(currentTime)));
                      }
                    }}
                    className="h-6 w-16 rounded-full border border-white/10 bg-white/12 px-2 text-center text-[12px] text-white outline-none"
                    autoFocus
                    aria-label="跳转到秒数"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setTimeInputValue(String(Math.floor(currentTime)));
                      setIsEditingTime(true);
                    }}
                    className="rounded-full px-1.5 py-1 transition hover:bg-white/12 hover:text-white"
                    title="跳转到指定秒数"
                  >
                    {formatVideoTime(currentTime)}
                  </button>
                )}
                <span className="px-0.5">/</span>
                <span>{formatVideoTime(duration)}</span>
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMuted}
                className={cn(
                  "flex items-center justify-center rounded-full bg-white/12 text-white/85 transition hover:bg-white/18 hover:text-white",
                  "size-7",
                )}
                title={isMuted ? "取消静音" : "静音"}
                aria-label={isMuted ? "取消静音" : "静音"}
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={isMuted ? 0 : volume}
                onChange={(event) => setVideoVolume(Number(event.currentTarget.value))}
                className={cn(
                  "h-1.5 cursor-pointer appearance-none rounded-full bg-white/25 accent-white [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white",
                  isDetail
                    ? "w-14 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3"
                    : "w-16 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3",
                )}
                aria-label="音量"
                title="音量"
              />
              <select
                value={playbackRate}
                onChange={(event) => setVideoPlaybackRate(Number(event.currentTarget.value))}
                className={cn(
                  "rounded-full border border-white/10 bg-white/12 px-2 font-medium text-white outline-none transition hover:bg-white/18",
                  isDetail ? "h-7 text-[11px]" : "h-7 text-[12px]",
                )}
                title="播放速度"
                aria-label="播放速度"
              >
                {PLAYBACK_RATES.map((rate) => (
                  <option key={rate} value={rate} className="bg-gray-950 text-white">
                    {rate}x
                  </option>
                ))}
              </select>
              {onToggleFullscreen && (
                <button
                  type="button"
                  onClick={onToggleFullscreen}
                  className={cn(
                    "flex items-center justify-center rounded-full bg-white/12 text-white/85 transition hover:bg-white/18 hover:text-white",
                    "size-7",
                  )}
                  title={isFullscreen ? "退出全屏" : "全屏"}
                  aria-label={isFullscreen ? "退出全屏" : "全屏"}
                >
                  {isFullscreen ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
