export const SAMPLE_YUCK = String.raw`;; ── ~/.config/eww/eww.yuck ─────────────────────────────────────
;; Конфиг прислан на ревью: бар с музыкой, часами и системным треем.

(defvar theme-bg "#15161e")
(defvar theme-bg "#15161e")

(defvar accent "#f2b04e")

;; --- вложенные файлы -------------------------------------------

(include "src/_volumes.yuck")
(include "src/_music.yuck")   ; такого файла нет — анализатор покажет warning

;; --- модули данных ---------------------------------------------

(defpoll volume :interval "0.2s"
  ` + "`pamixer --get-volume`" + String.raw`)

(defpoll volume-icon :interval "1s"
  ` + "`pamixer --get-volume`" + String.raw`)

(defpoll player :interval "0.5s"
  ` + "`playerctl metadata --format \"{{artist}} — {{title}}\"`" + String.raw`)

(defpoll clock :interval "0.5s"
  ` + "`date '+%H:%M:%S'`" + String.raw`)

(defpoll battery :interval "2s"
  ` + "`cat /sys/class/power_supply/BAT0/capacity`" + String.raw`)

(defpoll net :interval "2s"
  ` + "`iwgetid -r`" + String.raw`)

(defpoll weather :interval "20s"
  ` + "`curl -sf 'https://wttr.in/?format=%t' | tr -d '+°C'`" + String.raw`)

(defpoll cover :interval "1s"
  ` + "`playerctl metadata mpris:artUrl | sed 's/file:\\/\\///' | xargs -I{} convert {} -resize 96x96 /tmp/eww_cover.png && echo /tmp/eww_cover.png`" + String.raw`)

(defpoll uptime-str :interval "10s"
  ` + "`uptime -p | sed 's/up //' | awk '{printf \"%s %s %s %s %s\", $1, $2, $3, $4, $5}' | tr -s ' ' | tee /tmp/up.txt | xargs -I{} sh -c 'printf \"%s\" \"{}\"' | head -c 60`" + String.raw`)

;; --- слушатели ---------------------------------------------------

(deflisten battery-listen
  ` + "`while true; do cat /sys/class/power_supply/BAT0/capacity; done`" + String.raw`)

(deflisten volume-listen :initial "0"
  ` + "`pactl subscribe | while read -r _; do pamixer --get-volume; done`" + String.raw`)

;; --- виджеты -----------------------------------------------------

(defwidget workspaces
  (box :orientation "h" :spacing 6 :class "workspaces"
    (button :class "ws" :onclick "hyprctl dispatch workspace 1" "1")
    (button :class "ws" :onclick "hyprctl dispatch workspace 2" "2")
    (button :class "ws" :onclick "hyprctl dispatch workspace 3" "3")))

(defwidget player-module
  (box :orientation "h" :space-evenly false :spacing 8
    (image :path cover :class "cover" :image-width 28)
    (label :text player :class "player" :limit-width 42)))

(defwidget clock-module
  (label :text clock :class "clock"))

(defwidget orphan-note
  (label :text "забытый модуль" :class "note"))

(defwidget tray
  (box :orientation "h" :spacing 10
    (label :text volume :class "vol")
    (label :text net :class "net")
    (label :text battery :class "bat")
    (clock-module)))

;; --- окна --------------------------------------------------------

(defwindow bar
  :monitor 0
  :stacking "fg"
  :windowtype "dock"
  (centerbox :orientation "h"
    (workspaces)
    (player-module)
    (tray)))

(defwindow dashboard
  :geometry (geometry :x "0%" :y "0%" :width "100%" :height "100%")
  :stacking "fg"
  (box :class "dash"
    (label :text weather :class "weather")))
`;

export const SAMPLE_VOLUMES = String.raw`;; src/_volumes.yuck — модуль громкости, подключается из eww.yuck
;; через (include "src/_volumes.yuck")

(defwidget volume-icon-box
  (label :text volume-icon :class "vol-icon"))

(defwidget volume-slider
  (box :orientation "h" :space-evenly false :spacing 6 :class "volume"
    (volume-icon-box)
    (scale :min 0 :max 100 :value volume
      :onchange "pamixer --set-volume {}")))
`;

export const SAMPLE_SCSS = String.raw`/* ── ~/.config/eww/eww.scss ───────────────────────────────── */

* {
  all: unset;
  font-family: "JetBrains Mono";
  font-size: 12px;
}

.bar-bg {
  background-color: #15161e;
  border-bottom: 1px solid #242636;
  box-shadow: 0 8px 48px rgba(0, 0, 0, 0.55);

  .module {
    padding: 0 14px;

    .icon {
      color: #7aa2f7;

      .badge {
        .dot {
          .ring {
            .core {
              background-color: #7aa2f7;
              border-radius: 999px;
            }
          }
        }
      }
    }
  }
}

.workspaces {
  padding: 4px 10px;

  .ws {
    padding: 2px 9px;
    border-radius: 6px;
    color: #565f89;
    background-color: #1a1b26;

    &:hover {
      color: #7aa2f7;
      background-color: #24283b;
    }
  }
}

.player {
  color: #c0caf5;
  font-weight: 500;
}

.clock {
  color: #c0caf5 !important;
  font-weight: 700;
  letter-spacing: 1px;
}

.vol {
  color: #f2b04e !important;
}

.net {
  color: #7aa2f7;
}

.bat {
  color: #9ece6a;
}

.note {
  color: #c0caf5 !important;
}

.cover {
  border-radius: 8px;
}

.dash {
  background-color: rgba(21, 22, 30, 0.72);
  backdrop-filter: blur(24px);

  .weather {
    font-size: 42px;
    color: #7aa2f7;
    box-shadow: 0 12px 64px rgba(122, 162, 247, 0.25);
  }
}
`;
