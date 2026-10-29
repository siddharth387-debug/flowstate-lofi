// Runs in YouTube's MAIN page world to call YouTube's internal #movie_player API directly
(function () {
  window.addEventListener("lofi-yt-bridge", (event) => {
    try {
      const data = event.detail;
      if (!data) return;
      const player = document.getElementById("movie_player");
      if (!player) return;

      if (data.type === "SET_VOLUME" && typeof data.volume === "number") {
        if (typeof player.unMute === "function" && player.isMuted && player.isMuted()) {
          player.unMute();
        }
        if (typeof player.setVolume === "function") {
          player.setVolume(Math.max(0, Math.min(100, Math.round(data.volume))));
        }
      } else if (data.type === "SEEK_TO" && typeof data.seconds === "number") {
        if (typeof player.seekTo === "function") {
          player.seekTo(data.seconds, true);
        }
      }
    } catch (e) {}
  });
})();
