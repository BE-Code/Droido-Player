(function () {
  var cardSelect = document.getElementById('card-select');
  var scanBtn = document.getElementById('scan-btn');
  var scanStatus = document.getElementById('scan-status');
  var editorPanel = document.getElementById('editor-panel');
  var cardIdEl = document.getElementById('card-id');
  var cardTitleEl = document.getElementById('card-title');
  var playCardBtn = document.getElementById('play-card-btn');
  var editorStatus = document.getElementById('editor-status');
  var playbackBackBtn = document.getElementById('playback-back-btn');
  var playbackPlayPauseBtn = document.getElementById('playback-play-pause-btn');
  var playbackStopBtn = document.getElementById('playback-stop-btn');
  var playbackForwardBtn = document.getElementById('playback-forward-btn');
  var playbackStatus = document.getElementById('playback-status');
  var tracksEmpty = document.getElementById('tracks-empty');
  var trackList = document.getElementById('track-list');
  var fileInput = document.getElementById('file-input');
  var addAudioBtn = document.getElementById('add-audio-btn');
  var addAudioModal = document.getElementById('add-audio-modal');
  var addAudioChoice = document.getElementById('add-audio-choice');
  var addAudioRecord = document.getElementById('add-audio-record');
  var recordOptionBtn = document.getElementById('record-option-btn');
  var uploadOptionBtn = document.getElementById('upload-option-btn');
  var addAudioCancelBtn = document.getElementById('add-audio-cancel-btn');
  var recordStatus = document.getElementById('record-status');
  var recordStartBtn = document.getElementById('record-start-btn');
  var recordStopBtn = document.getElementById('record-stop-btn');
  var recordBackBtn = document.getElementById('record-back-btn');
  var addAudioUrl = document.getElementById('add-audio-url');
  var urlOptionBtn = document.getElementById('url-option-btn');
  var audioUrlInput = document.getElementById('audio-url-input');
  var urlFetchBtn = document.getElementById('url-fetch-btn');
  var urlBackBtn = document.getElementById('url-back-btn');
  var urlFetchStatus = document.getElementById('url-fetch-status');
  var importModal = document.getElementById('import-modal');
  var importQueueLabel = document.getElementById('import-queue-label');
  var importFileStem = document.getElementById('import-file-stem');
  var importFileExt = document.getElementById('import-file-ext');
  var importFilenameHint = document.getElementById('import-filename-hint');
  var importAudio = document.getElementById('import-audio');
  var importStatus = document.getElementById('import-status');
  var importSaveBtn = document.getElementById('import-save-btn');
  var importDeleteBtn = document.getElementById('import-delete-btn');
  var importCancelBtn = document.getElementById('import-cancel-btn');
  var importTitle = document.getElementById('import-title');
  var segmentBtns = importModal.querySelectorAll('.segmented-btn');
  var volumeSlider = document.getElementById('volume-slider');
  var volumeValue = document.getElementById('volume-value');

  var currentId = null;
  var tracks = [];
  var missing = [];
  var saveTimer = null;
  var savePromise = null;
  var importQueue = [];
  var importTotal = 0;
  var currentStaging = null;
  var stagingMode = 'import';
  var editingTrackName = null;
  var editingTrackIndex = null;
  var selectedVariant = 'original';
  var normalizedUrl = null;
  var normalizeInFlight = null;
  var variantSwitchGeneration = 0;
  var mediaStream = null;
  var mediaRecorder = null;
  var recordedChunks = [];
  var recordMimeType = '';
  var volumeSaveTimer = null;
  var playbackPollTimer = null;
  var playbackActive = false;
  var playbackPaused = false;
  var playbackStopped = true;
  var nowPlayingId = null;

  function setStatus(el, text, kind) {
    el.textContent = text || '';
    el.className = kind || 'muted';
    el.hidden = !text;
  }

  function setPlaybackError(text) {
    setStatus(playbackStatus, text, 'dead');
  }

  function clearPlaybackStatus() {
    setStatus(playbackStatus, '', 'muted');
  }

  function formatVolume(level) {
    return Math.round(level) + '%';
  }

  function showVolume(level) {
    var rounded = Math.round(level);
    volumeSlider.value = String(rounded);
    volumeValue.textContent = formatVolume(rounded);
  }

  function loadVolume() {
    return fetch('/api/volume')
      .then(function (res) {
        if (!res.ok) {
          throw new Error('volume load failed');
        }
        return res.json();
      })
      .then(function (data) {
        if (typeof data.volume === 'number') {
          showVolume(data.volume);
        }
      })
      .catch(function () {
        showVolume(Number(volumeSlider.value) || 100);
      });
  }

  function saveVolume(level) {
    return fetch('/api/volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume: level }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            throw new Error((data && data.error) || 'volume save failed');
          }
          return data;
        });
      })
      .then(function (data) {
        if (typeof data.volume === 'number') {
          showVolume(data.volume);
        }
      })
      .catch(function (err) {
        setStatus(editorStatus, 'Volume: ' + (err.message || 'save failed'), 'dead');
      });
  }

  function queueVolumeSave(level) {
    if (volumeSaveTimer) {
      clearTimeout(volumeSaveTimer);
    }
    volumeSaveTimer = setTimeout(function () {
      volumeSaveTimer = null;
      saveVolume(level);
    }, 150);
  }

  function persistCard() {
    if (!currentId) {
      return Promise.resolve();
    }
    if (savePromise) {
      return savePromise;
    }
    setStatus(editorStatus, 'Saving…', 'live');
    savePromise = fetch('/api/cards/' + encodeURIComponent(currentId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    })
      .then(function (res) {
        if (!res.ok) {
          throw new Error('save failed');
        }
        return res.json();
      })
      .then(function (card) {
        tracks = card.tracks.slice();
        missing = card.missing || [];
        renderTracks();
        setStatus(editorStatus, 'Saved', 'muted');
        return refreshCardList(currentId);
      })
      .catch(function () {
        setStatus(editorStatus, 'Save failed', 'dead');
        throw new Error('save failed');
      })
      .finally(function () {
        savePromise = null;
      });
    return savePromise;
  }

  function queueSave() {
    if (!currentId) {
      return;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(function () {
      saveTimer = null;
      persistCard();
    }, 400);
  }

  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    return persistCard();
  }

  function cardDisplayLabel(title, id) {
    var trimmed = (title || '').trim();
    return trimmed || id;
  }

  function optionLabel(card) {
    return cardDisplayLabel(card.title, card.id);
  }

  function updateCardIdDisplay() {
    var labelRow = cardIdEl.closest('.card-id-label');
    if (!labelRow) {
      return;
    }
    var title = cardTitleEl.value.trim();
    if (title) {
      labelRow.hidden = true;
      return;
    }
    labelRow.hidden = false;
    cardIdEl.textContent = currentId || '';
  }

  function syncCardSelectOptionLabel() {
    if (!currentId) {
      return;
    }
    var options = cardSelect.options;
    for (var i = 0; i < options.length; i++) {
      if (options[i].value === currentId) {
        options[i].textContent = cardDisplayLabel(cardTitleEl.value, currentId);
        break;
      }
    }
  }

  function refreshCardList(selectId) {
    return fetch('/api/cards')
      .then(function (res) { return res.json(); })
      .then(function (cards) {
        cardSelect.innerHTML = '<option value="">— choose a card —</option>';
        cards.forEach(function (card) {
          var opt = document.createElement('option');
          opt.value = card.id;
          opt.textContent = optionLabel(card);
          cardSelect.appendChild(opt);
        });
        if (selectId) {
          cardSelect.value = selectId;
        }
      });
  }

  function renderTracks() {
    trackList.innerHTML = '';
    tracksEmpty.hidden = tracks.length > 0;
    tracks.forEach(function (name, index) {
      var li = document.createElement('li');
      li.className = 'track-item';
      if (missing.indexOf(name) >= 0) {
        li.classList.add('missing');
      }
      li.dataset.index = String(index);

      var dragHandle = document.createElement('span');
      dragHandle.className = 'track-drag-handle';
      dragHandle.title = 'Drag to reorder';
      dragHandle.setAttribute('role', 'button');
      dragHandle.setAttribute('aria-label', 'Drag to reorder');
      dragHandle.tabIndex = 0;
      dragHandle.textContent = '⠿';
      li.appendChild(dragHandle);

      var nameSpan = document.createElement('span');
      nameSpan.className = 'track-name';
      nameSpan.textContent = name;
      li.appendChild(nameSpan);

      var actions = document.createElement('span');
      actions.className = 'track-actions';

      var isMissing = missing.indexOf(name) >= 0;
      if (isMissing) {
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'icon-btn';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove from playlist';
        removeBtn.setAttribute('aria-label', 'Remove from playlist');
        removeBtn.addEventListener('click', function () {
          removeTrackFromPlaylist(name, index);
        });
        actions.appendChild(removeBtn);
      } else {
        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'icon-btn icon-edit';
        editBtn.title = 'Edit track';
        editBtn.setAttribute('aria-label', 'Edit track');
        editBtn.addEventListener('click', function () {
          openTrackEdit(name, index);
        });
        actions.appendChild(editBtn);
      }
      li.appendChild(actions);

      trackList.appendChild(li);
    });
  }

  var POINTER_DRAG_THRESHOLD = 8;
  var pointerDrag = null;

  function clearDragOver() {
    trackList.querySelectorAll('.drag-over').forEach(function (el) {
      el.classList.remove('drag-over');
    });
  }

  function findTrackItemAtPoint(x, y) {
    var els = document.elementsFromPoint(x, y);
    for (var i = 0; i < els.length; i++) {
      var li = els[i].closest && els[i].closest('.track-item');
      if (li && trackList.contains(li) && !li.classList.contains('dragging')) {
        return li;
      }
    }
    return null;
  }

  function endPointerDrag(commit) {
    if (!pointerDrag) {
      return;
    }
    var from = pointerDrag.from;
    var to = pointerDrag.over;
    var item = pointerDrag.item;
    pointerDrag = null;
    document.body.classList.remove('track-reorder-active');
    if (commit && to !== null && to !== from) {
      moveTrack(from, to);
      return;
    }
    item.classList.remove('dragging');
    clearDragOver();
  }

  function onTrackPointerMove(e) {
    if (!pointerDrag || e.pointerId !== pointerDrag.pointerId) {
      return;
    }
    var dx = e.clientX - pointerDrag.startX;
    var dy = e.clientY - pointerDrag.startY;
    if (!pointerDrag.started) {
      if (Math.abs(dx) + Math.abs(dy) < POINTER_DRAG_THRESHOLD) {
        return;
      }
      pointerDrag.started = true;
      pointerDrag.item.classList.add('dragging');
      document.body.classList.add('track-reorder-active');
    }
    e.preventDefault();
    var over = findTrackItemAtPoint(e.clientX, e.clientY);
    clearDragOver();
    if (over) {
      var idx = Number(over.dataset.index);
      if (idx !== pointerDrag.from) {
        over.classList.add('drag-over');
        pointerDrag.over = idx;
      } else {
        pointerDrag.over = null;
      }
    } else {
      pointerDrag.over = null;
    }
  }

  function onTrackPointerUp(e) {
    if (!pointerDrag || e.pointerId !== pointerDrag.pointerId) {
      return;
    }
    var commit = pointerDrag.started;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* already released */
    }
    e.currentTarget.removeEventListener('pointermove', onTrackPointerMove);
    e.currentTarget.removeEventListener('pointerup', onTrackPointerUp);
    e.currentTarget.removeEventListener('pointercancel', onTrackPointerUp);
    endPointerDrag(commit);
  }

  function onTrackPointerDown(e) {
    if (e.button !== 0) {
      return;
    }
    var handle = e.target.closest('.track-drag-handle');
    if (!handle || !trackList.contains(handle)) {
      return;
    }
    var li = handle.closest('.track-item');
    if (!li) {
      return;
    }
    pointerDrag = {
      from: Number(li.dataset.index),
      item: li,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      over: null
    };
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', onTrackPointerMove, { passive: false });
    handle.addEventListener('pointerup', onTrackPointerUp);
    handle.addEventListener('pointercancel', onTrackPointerUp);
    e.preventDefault();
  }

  function setupTrackListPointerReorder() {
    if (trackList.dataset.pointerReorderBound) {
      return;
    }
    trackList.dataset.pointerReorderBound = '1';
    trackList.addEventListener('pointerdown', onTrackPointerDown);
  }

  function moveTrack(from, to) {
    if (to < 0 || to >= tracks.length) {
      return;
    }
    var item = tracks.splice(from, 1)[0];
    tracks.splice(to, 0, item);
    queueSave();
    renderTracks();
  }

  function removeTrackFromPlaylist(trackName, trackIndex) {
    if (!currentId) {
      return;
    }
    var isMissing = missing.indexOf(trackName) >= 0;
    var msg = isMissing
      ? 'Remove this missing track from the playlist?'
      : 'Delete this track file? It will be removed from the playlist.';
    if (!window.confirm(msg)) {
      return;
    }
    fetch(
      '/api/cards/' + encodeURIComponent(currentId) +
        '/tracks/' + encodeURIComponent(trackName),
      { method: 'DELETE' }
    )
      .then(function (res) {
        if (!res.ok) {
          throw new Error('delete failed');
        }
        if (trackIndex !== null && trackIndex >= 0 && trackIndex < tracks.length) {
          tracks.splice(trackIndex, 1);
        } else {
          var i = tracks.indexOf(trackName);
          if (i >= 0) {
            tracks.splice(i, 1);
          }
        }
        missing = missing.filter(function (m) { return tracks.indexOf(m) >= 0; });
        renderTracks();
        return flushSave();
      })
      .catch(function () {
        setStatus(editorStatus, 'Could not remove track', 'dead');
      });
  }

  function openCard(id) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    currentId = id;
    return fetch('/api/cards/' + encodeURIComponent(id))
      .then(function (res) {
        if (!res.ok) {
          throw new Error('load failed');
        }
        return res.json();
      })
      .then(function (card) {
        cardTitleEl.value = card.title || '';
        tracks = card.tracks.slice();
        missing = card.missing || [];
        editorPanel.hidden = false;
        renderTracks();
        updateCardIdDisplay();
        setStatus(editorStatus, '', 'muted');
        cardSelect.value = card.id;
      });
  }

  function payload() {
    return {
      title: cardTitleEl.value,
      tracks: tracks,
    };
  }

  function updatePlaybackTransportUi() {
    var playing = playbackActive && !playbackPaused;
    playbackPlayPauseBtn.classList.toggle('is-playing', playing);
    playbackStopBtn.disabled = playbackStopped;
    if (playing) {
      playbackPlayPauseBtn.title = 'Pause';
      playbackPlayPauseBtn.setAttribute('aria-label', 'Pause');
    } else if (playbackActive && playbackPaused) {
      playbackPlayPauseBtn.title = 'Resume';
      playbackPlayPauseBtn.setAttribute('aria-label', 'Resume');
    } else {
      playbackPlayPauseBtn.title = 'Play';
      playbackPlayPauseBtn.setAttribute('aria-label', 'Play');
    }
    playbackPlayPauseBtn.disabled = false;
  }

  function applyPlaybackState(data) {
    playbackStopped = !data || !data.active || !!data.stopped;
    playbackActive = !!(data && data.active && !data.stopped);
    playbackPaused = playbackActive && !!(data && data.paused);
    if (data && data.cardId) {
      nowPlayingId = data.cardId;
    }
    updatePlaybackTransportUi();
  }

  function refreshPlaybackState() {
    return fetch('/api/playback')
      .then(function (res) {
        if (!res.ok) {
          throw new Error('playback state failed');
        }
        return res.json();
      })
      .then(applyPlaybackState)
      .catch(function () {
        playbackActive = false;
        playbackPaused = false;
        playbackStopped = true;
        updatePlaybackTransportUi();
      });
  }

  function startPlaybackPoll() {
    if (playbackPollTimer) {
      return;
    }
    playbackPollTimer = setInterval(refreshPlaybackState, 2000);
  }

  function startPlaylist(cardId, statusEl) {
    if (!cardId) {
      if (statusEl === playbackStatus) {
        setPlaybackError('No playlist to play');
      } else {
        setStatus(statusEl, 'No playlist to play', 'dead');
      }
      return Promise.reject(new Error('no card'));
    }
    var playRequest = cardId === currentId
      ? flushSave().catch(function () { throw new Error('save failed'); })
      : Promise.resolve();
    return playRequest.then(function () {
      return fetch('/api/cards/' + encodeURIComponent(cardId) + '/play', {
        method: 'POST',
      })
        .then(function (res) {
          if (!res.ok && res.status !== 204) {
            throw new Error('play failed');
          }
          nowPlayingId = cardId;
          if (statusEl === playbackStatus) {
            clearPlaybackStatus();
          } else {
            setStatus(statusEl, 'Playing…', 'live');
          }
          startPlaybackPoll();
          return refreshPlaybackState();
        });
    })
      .catch(function (err) {
        if (err && err.message === 'save failed') {
          if (statusEl === playbackStatus) {
            setPlaybackError('Could not save card before playing');
          } else {
            setStatus(statusEl, 'Could not save card before playing', 'dead');
          }
          throw err;
        }
        if (statusEl === playbackStatus) {
          setPlaybackError('Play failed');
        } else {
          setStatus(statusEl, 'Play failed', 'dead');
        }
        throw new Error('play failed');
      });
  }

  function playCard() {
    if (!currentId) {
      setStatus(editorStatus, 'Open a card first', 'dead');
      return Promise.reject(new Error('no card'));
    }
    playCardBtn.disabled = true;
    return startPlaylist(currentId, editorStatus).finally(function () {
      playCardBtn.disabled = false;
    });
  }

  function playNowPlaying() {
    return startPlaylist(nowPlayingId || currentId, playbackStatus);
  }

  function postPlayback(path) {
    return fetch(path, { method: 'POST' }).then(function (res) {
      if (!res.ok && res.status !== 204) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          throw new Error((data && data.error) || 'request failed');
        });
      }
      return refreshPlaybackState();
    });
  }

  function togglePlayPause() {
    if (playbackActive && !playbackPaused) {
      postPlayback('/api/pause')
        .then(clearPlaybackStatus)
        .catch(function (err) {
          setPlaybackError(err.message || 'Pause failed');
        });
      return;
    }
    if (playbackActive && playbackPaused) {
      postPlayback('/api/resume')
        .then(clearPlaybackStatus)
        .catch(function (err) {
          setPlaybackError(err.message || 'Resume failed');
        });
      return;
    }
    playNowPlaying().catch(function () {});
  }

  cardSelect.addEventListener('change', function () {
    var id = cardSelect.value;
    var previousId = currentId;
    flushSave().finally(function () {
      if (!id) {
        editorPanel.hidden = true;
        currentId = null;
        return;
      }
      if (id === previousId && currentId === id) {
        return;
      }
      openCard(id).catch(function () {
        setStatus(editorStatus, 'Could not load card', 'dead');
      });
    });
  });

  scanBtn.addEventListener('click', function () {
    scanBtn.disabled = true;
    setStatus(scanStatus, 'Waiting for tap…', 'live');
    fetch('/wait-tap')
      .then(function (res) {
        if (res.status === 408) {
          setStatus(scanStatus, 'Timed out', 'dead');
          return null;
        }
        if (!res.ok) {
          setStatus(scanStatus, 'Request failed', 'dead');
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) {
          return;
        }
        setStatus(scanStatus, 'Tap received', 'muted');
        return flushSave().then(function () {
          return refreshCardList(data.id);
        }).then(function () {
          return openCard(data.id);
        });
      })
      .catch(function () {
        setStatus(scanStatus, 'Network error', 'dead');
      })
      .finally(function () {
        scanBtn.disabled = false;
      });
  });

  cardTitleEl.addEventListener('input', function () {
    queueSave();
    updateCardIdDisplay();
    syncCardSelectOptionLabel();
  });

  playCardBtn.addEventListener('click', function () {
    playCard().catch(function () {});
  });

  playbackBackBtn.addEventListener('click', function () {
    postPlayback('/api/back')
      .then(clearPlaybackStatus)
      .catch(function (err) {
        setPlaybackError(err.message || 'Skip back failed');
      });
  });

  playbackForwardBtn.addEventListener('click', function () {
    postPlayback('/api/forward')
      .then(clearPlaybackStatus)
      .catch(function (err) {
        setPlaybackError(err.message || 'Skip forward failed');
      });
  });

  playbackPlayPauseBtn.addEventListener('click', togglePlayPause);

  playbackStopBtn.addEventListener('click', function () {
    postPlayback('/api/stop')
      .then(clearPlaybackStatus)
      .catch(function (err) {
        setPlaybackError(err.message || 'Stop failed');
      });
  });

  function setImportStatus(text, kind) {
    setStatus(importStatus, text, kind);
  }

  function updateSegmentUi() {
    segmentBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.variant === selectedVariant);
    });
  }

  function setSegmentButtonsEnabled(enabled) {
    segmentBtns.forEach(function (btn) {
      if (enabled) {
        btn.disabled = false;
        btn.removeAttribute('disabled');
      } else {
        btn.disabled = true;
      }
    });
  }

  function updateImportAudioSrc() {
    if (!currentStaging) {
      return;
    }
    if (selectedVariant === 'normalized' && normalizedUrl) {
      importAudio.src = normalizedUrl;
    } else {
      importAudio.src = currentStaging.originalUrl;
    }
    importAudio.load();
  }

  function closeImportModal() {
    importModal.hidden = true;
    importAudio.pause();
    importAudio.removeAttribute('src');
    currentStaging = null;
    stagingMode = 'import';
    editingTrackName = null;
    editingTrackIndex = null;
    normalizedUrl = null;
    selectedVariant = 'original';
    normalizeInFlight = null;
    variantSwitchGeneration = 0;
    updateSegmentUi();
    setImportStatus('', 'muted');
    importFileStem.classList.remove('invalid');
    importDeleteBtn.hidden = true;
    importTitle.textContent = 'Import audio';
    importSaveBtn.textContent = 'Save to card';
    setSegmentButtonsEnabled(true);
  }

  function discardStaging(stagingId) {
    if (!currentId || !stagingId) {
      return Promise.resolve();
    }
    return fetch(
      '/api/cards/' + encodeURIComponent(currentId) + '/staging/' + encodeURIComponent(stagingId),
      { method: 'DELETE' }
    ).catch(function () {});
  }

  function ensureNormalized() {
    if (normalizedUrl) {
      return Promise.resolve(normalizedUrl);
    }
    if (normalizeInFlight) {
      return normalizeInFlight;
    }
    if (!currentStaging) {
      return Promise.reject(new Error('no staging'));
    }
    normalizeInFlight = fetch(
      '/api/cards/' + encodeURIComponent(currentId) +
        '/staging/' + encodeURIComponent(currentStaging.stagingId) + '/normalize',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalName: currentStaging.originalName }),
      }
    )
      .then(function (res) {
        if (res.status === 503) {
          throw new Error('unavailable');
        }
        if (!res.ok) {
          throw new Error('normalize failed');
        }
        return res.json();
      })
      .then(function (data) {
        normalizedUrl = data.normalizedUrl;
        return normalizedUrl;
      })
      .finally(function () {
        normalizeInFlight = null;
      });
    return normalizeInFlight;
  }

  var invalidFilenameChars = /[\\/:*?"<>|]/;
  var controlChars = /[\x00-\x1f]/;

  function splitFileName(name) {
    var i = name.lastIndexOf('.');
    if (i <= 0) {
      return { stem: name, ext: '' };
    }
    return { stem: name.slice(0, i), ext: name.slice(i) };
  }

  function validateFileStem(stem, ext) {
    var fs = (stem || '').trim();
    if (!fs) {
      return 'Enter a file name.';
    }
    if (fs === '.' || fs === '..') {
      return 'Name cannot be . or ..';
    }
    if (invalidFilenameChars.test(fs)) {
      return 'Name cannot include \\ / : * ? " < > |';
    }
    if (controlChars.test(fs)) {
      return 'Name cannot include control characters.';
    }
    if (/[.\s]$/.test(fs)) {
      return 'Name cannot end with a space or period.';
    }
    if (ext && fs.toLowerCase().endsWith(ext.toLowerCase()) && fs.length > ext.length) {
      return 'Do not type the extension — it is shown beside the name.';
    }
    return null;
  }

  function refreshImportFilenameState() {
    var ext = importFileExt.textContent || '';
    var nameErr = validateFileStem(importFileStem.value, ext);
    var normBlocked = selectedVariant === 'normalized' && !normalizedUrl;
    importFileStem.classList.toggle('invalid', !!nameErr);
    importSaveBtn.disabled = !!nameErr || normBlocked;
    if (nameErr) {
      setImportStatus(nameErr, 'dead');
    }
    return !nameErr;
  }

  function openImportModal(staging, queueIndex, queueTotal, mode) {
    stagingMode = mode || 'import';
    if (stagingMode !== 'edit') {
      editingTrackName = null;
      editingTrackIndex = null;
    }
    currentStaging = staging;
    selectedVariant = 'original';
    normalizedUrl = staging.normalizedUrl || null;
    var parts = splitFileName(staging.originalName);
    importFileStem.value = parts.stem;
    importFileExt.textContent = parts.ext || '';
    importFileExt.hidden = !parts.ext;
    importFilenameHint.textContent = parts.ext
      ? 'Use letters, numbers, spaces, dashes, and underscores. No \\ / : * ? " < > | and do not type the extension.'
      : 'Use letters, numbers, spaces, dashes, and underscores. No \\ / : * ? " < > |';
    if (queueTotal > 1) {
      importQueueLabel.textContent = 'File ' + (queueIndex + 1) + ' of ' + queueTotal;
      importQueueLabel.hidden = false;
    } else {
      importQueueLabel.hidden = true;
    }
    updateSegmentUi();
    updateImportAudioSrc();
    importModal.hidden = false;
    setImportStatus('', 'muted');
    if (stagingMode === 'edit') {
      importTitle.textContent = 'Edit track';
      importSaveBtn.textContent = 'Save changes';
      importDeleteBtn.hidden = false;
    } else {
      importTitle.textContent = 'Import audio';
      importSaveBtn.textContent = 'Save to card';
      importDeleteBtn.hidden = true;
    }
    refreshImportFilenameState();
  }

  importFileStem.addEventListener('input', function () {
    if (!currentStaging) {
      return;
    }
    var valid = refreshImportFilenameState();
    if (valid) {
      setImportStatus('', 'muted');
    }
  });

  function openTrackEdit(trackName, trackIndex) {
    if (!currentId) {
      return;
    }
    setStatus(editorStatus, 'Loading track…', 'live');
    fetch(
      '/api/cards/' + encodeURIComponent(currentId) +
        '/tracks/' + encodeURIComponent(trackName) + '/edit',
      { method: 'POST' }
    )
      .then(function (res) {
        if (!res.ok) {
          throw new Error('edit failed');
        }
        return res.json();
      })
      .then(function (staging) {
        setStatus(editorStatus, '', 'muted');
        editingTrackName = trackName;
        editingTrackIndex = trackIndex;
        openImportModal(staging, 0, 1, 'edit');
      })
      .catch(function () {
        setStatus(editorStatus, 'Could not open track for editing', 'dead');
      });
  }

  function processImportQueue() {
    if (!importQueue.length) {
      importTotal = 0;
      setStatus(editorStatus, 'Done adding files', 'muted');
      return;
    }
    var file = importQueue.shift();
    var index = importTotal - importQueue.length - 1;
    setStatus(editorStatus, 'Uploading…', 'live');
    var form = new FormData();
    form.append('file', file);
    fetch('/api/cards/' + encodeURIComponent(currentId) + '/tracks', {
      method: 'POST',
      body: form,
    })
      .then(function (res) {
        if (!res.ok) {
          throw new Error('upload failed');
        }
        return res.json();
      })
      .then(function (staging) {
        setStatus(editorStatus, '', 'muted');
        openImportModal(staging, index, importTotal);
      })
      .catch(function () {
        setStatus(editorStatus, 'Upload failed', 'dead');
        processImportQueue();
      });
  }

  function finishImportAndNext() {
    var stagingId = currentStaging ? currentStaging.stagingId : null;
    closeImportModal();
    processImportQueue();
    return stagingId;
  }

  segmentBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var variant = btn.dataset.variant;
      if (!currentStaging) {
        return;
      }
      if (variant === 'original') {
        if (selectedVariant === 'original') {
          return;
        }
        variantSwitchGeneration += 1;
        selectedVariant = 'original';
        updateSegmentUi();
        updateImportAudioSrc();
        setImportStatus('', 'muted');
        setSegmentButtonsEnabled(true);
        refreshImportFilenameState();
        return;
      }
      if (selectedVariant === 'normalized' || normalizeInFlight) {
        return;
      }
      if (normalizedUrl) {
        selectedVariant = 'normalized';
        updateSegmentUi();
        updateImportAudioSrc();
        setImportStatus('', 'muted');
        refreshImportFilenameState();
        return;
      }
      variantSwitchGeneration += 1;
      var switchId = variantSwitchGeneration;
      importSaveBtn.disabled = true;
      setSegmentButtonsEnabled(false);
      setImportStatus('Processing normalization…', 'live');
      ensureNormalized()
        .then(function () {
          if (switchId !== variantSwitchGeneration) {
            return;
          }
          selectedVariant = 'normalized';
          updateSegmentUi();
          updateImportAudioSrc();
          setImportStatus('', 'muted');
        })
        .catch(function (err) {
          if (switchId !== variantSwitchGeneration) {
            return;
          }
          if (err && err.message === 'unavailable') {
            setImportStatus('Normalization unavailable — install ffmpeg in Termux', 'dead');
          } else {
            setImportStatus('Normalization failed — try Original', 'dead');
          }
          selectedVariant = 'original';
          updateSegmentUi();
          updateImportAudioSrc();
        })
        .finally(function () {
          setSegmentButtonsEnabled(true);
          if (switchId === variantSwitchGeneration) {
            refreshImportFilenameState();
          }
        });
    });
  });

  importSaveBtn.addEventListener('click', function () {
    if (!currentStaging || !currentId) {
      return;
    }
    if (selectedVariant === 'normalized' && !normalizedUrl) {
      setImportStatus('Wait for normalization or choose Original', 'dead');
      return;
    }
    if (!refreshImportFilenameState()) {
      return;
    }
    importSaveBtn.disabled = true;
    importCancelBtn.disabled = true;
    setImportStatus('Saving…', 'live');
    var commitBody = {
      choice: selectedVariant,
      originalName: currentStaging.originalName,
      fileStem: importFileStem.value,
    };
    if (stagingMode === 'edit' && editingTrackName) {
      commitBody.replaceTrack = editingTrackName;
    }
    fetch(
      '/api/cards/' + encodeURIComponent(currentId) +
        '/staging/' + encodeURIComponent(currentStaging.stagingId) + '/commit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commitBody),
      }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            throw new Error((data && data.error) || 'commit failed');
          }
          return data;
        }).catch(function (err) {
          if (err && err.message) {
            throw err;
          }
          if (!res.ok) {
            throw new Error('commit failed');
          }
          throw err;
        });
      })
      .then(function (data) {
        if (stagingMode === 'edit' && editingTrackIndex !== null) {
          tracks[editingTrackIndex] = data.filename;
          missing = missing.filter(function (m) {
            return m !== editingTrackName && tracks.indexOf(m) >= 0;
          });
        } else if (tracks.indexOf(data.filename) < 0) {
          tracks.push(data.filename);
        }
        renderTracks();
        return flushSave().then(function () {
          if (stagingMode === 'edit') {
            closeImportModal();
          } else {
            finishImportAndNext();
          }
          importCancelBtn.disabled = false;
        });
      })
      .catch(function (err) {
        setImportStatus((err && err.message) || 'Save failed', 'dead');
        refreshImportFilenameState();
        importCancelBtn.disabled = false;
      });
  });

  importCancelBtn.addEventListener('click', function () {
    if (!currentStaging) {
      closeImportModal();
      if (stagingMode !== 'edit') {
        processImportQueue();
      }
      return;
    }
    var stagingId = currentStaging.stagingId;
    var wasEdit = stagingMode === 'edit';
    importCancelBtn.disabled = true;
    discardStaging(stagingId).finally(function () {
      if (wasEdit) {
        closeImportModal();
      } else {
        finishImportAndNext();
      }
      importCancelBtn.disabled = false;
    });
  });

  importDeleteBtn.addEventListener('click', function () {
    if (stagingMode !== 'edit' || !editingTrackName || !currentId) {
      return;
    }
    if (!window.confirm('Delete this track file? It will be removed from the playlist.')) {
      return;
    }
    var trackName = editingTrackName;
    var trackIndex = editingTrackIndex;
    var stagingId = currentStaging ? currentStaging.stagingId : null;
    importDeleteBtn.disabled = true;
    importSaveBtn.disabled = true;
    importCancelBtn.disabled = true;
    setImportStatus('Deleting…', 'live');
    fetch(
      '/api/cards/' + encodeURIComponent(currentId) +
        '/tracks/' + encodeURIComponent(trackName),
      { method: 'DELETE' }
    )
      .then(function (res) {
        if (!res.ok) {
          throw new Error('delete failed');
        }
        if (trackIndex !== null && trackIndex >= 0 && trackIndex < tracks.length) {
          tracks.splice(trackIndex, 1);
        } else {
          var i = tracks.indexOf(trackName);
          if (i >= 0) {
            tracks.splice(i, 1);
          }
        }
        missing = missing.filter(function (m) { return tracks.indexOf(m) >= 0; });
        renderTracks();
        if (stagingId) {
          return discardStaging(stagingId);
        }
      })
      .then(function () {
        return flushSave();
      })
      .then(function () {
        closeImportModal();
      })
      .catch(function () {
        setImportStatus('Delete failed', 'dead');
      })
      .finally(function () {
        importDeleteBtn.disabled = false;
        importSaveBtn.disabled = false;
        importCancelBtn.disabled = false;
      });
  });

  window.addEventListener('beforeunload', function () {
    if (currentStaging && currentId) {
      discardStaging(currentStaging.stagingId);
    }
  });

  function showAddAudioChoice() {
    addAudioChoice.hidden = false;
    addAudioRecord.hidden = true;
    addAudioUrl.hidden = true;
    setStatus(recordStatus, 'Tap Start, then speak. Tap Stop when finished.', 'muted');
    recordStartBtn.hidden = false;
    recordStopBtn.hidden = true;
    recordStartBtn.disabled = false;
  }

  function showAddAudioRecord() {
    addAudioChoice.hidden = true;
    addAudioRecord.hidden = false;
    addAudioUrl.hidden = true;
    setStatus(recordStatus, 'Tap Start, then speak. Tap Stop when finished.', 'muted');
    recordStartBtn.hidden = false;
    recordStopBtn.hidden = true;
    recordStartBtn.disabled = false;
    recordStopBtn.disabled = false;
  }

  function showAddAudioUrl() {
    addAudioChoice.hidden = true;
    addAudioRecord.hidden = true;
    addAudioUrl.hidden = false;
    audioUrlInput.value = '';
    setStatus(urlFetchStatus, '', 'muted');
    urlFetchBtn.disabled = false;
  }

  function cleanupRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch (e) {}
    }
    mediaRecorder = null;
    recordedChunks = [];
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (t) { t.stop(); });
      mediaStream = null;
    }
    recordStartBtn.hidden = false;
    recordStopBtn.hidden = true;
    recordStartBtn.disabled = false;
  }

  function pickRecorderMime() {
    var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (var i = 0; i < types.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(types[i])) {
        return types[i];
      }
    }
    return '';
  }

  function recordingExtension(mime) {
    if (mime.indexOf('mp4') >= 0) {
      return 'm4a';
    }
    if (mime.indexOf('ogg') >= 0) {
      return 'ogg';
    }
    return 'webm';
  }

  function recordingFilename() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var stamp = d.getFullYear() +
      pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    return 'recording-' + stamp + '.' + recordingExtension(recordMimeType);
  }

  function openAddAudioModal() {
    if (!currentId) {
      return;
    }
    showAddAudioChoice();
    addAudioModal.hidden = false;
  }

  function closeAddAudioModal() {
    cleanupRecording();
    addAudioModal.hidden = true;
    showAddAudioChoice();
  }

  function startFileImport(files) {
    if (!files.length) {
      return;
    }
    closeAddAudioModal();
    importQueue = Array.prototype.slice.call(files);
    importTotal = importQueue.length;
    processImportQueue();
  }

  function startUrlImport(url) {
    var trimmed = (url || '').trim();
    if (!currentId) {
      return;
    }
    if (!trimmed) {
      setStatus(urlFetchStatus, 'Enter a URL.', 'dead');
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      setStatus(urlFetchStatus, 'URL must start with http:// or https://', 'dead');
      return;
    }
    urlFetchBtn.disabled = true;
    setStatus(urlFetchStatus, 'Downloading with yt-dlp… (may take a while)', 'live');
    fetch('/api/cards/' + encodeURIComponent(currentId) + '/tracks/from-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: trimmed }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        }).catch(function () {
          return { res: res, data: {} };
        });
      })
      .then(function (x) {
        urlFetchBtn.disabled = false;
        if (!x.res.ok) {
          var msg = (x.data && x.data.error) ? x.data.error : ('HTTP ' + x.res.status);
          setStatus(urlFetchStatus, msg, 'dead');
          return;
        }
        setStatus(urlFetchStatus, '', 'muted');
        closeAddAudioModal();
        importTotal = 1;
        importQueue = [];
        openImportModal(x.data, 0, 1);
      })
      .catch(function () {
        urlFetchBtn.disabled = false;
        setStatus(urlFetchStatus, 'Network error.', 'dead');
      });
  }

  addAudioBtn.addEventListener('click', openAddAudioModal);

  addAudioCancelBtn.addEventListener('click', closeAddAudioModal);

  addAudioModal.querySelector('.modal-backdrop').addEventListener('click', closeAddAudioModal);

  uploadOptionBtn.addEventListener('click', function () {
    fileInput.click();
  });

  urlOptionBtn.addEventListener('click', showAddAudioUrl);

  urlBackBtn.addEventListener('click', showAddAudioChoice);

  urlFetchBtn.addEventListener('click', function () {
    startUrlImport(audioUrlInput.value);
  });

  audioUrlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      startUrlImport(audioUrlInput.value);
    }
  });

  recordOptionBtn.addEventListener('click', function () {
    if (!window.MediaRecorder) {
      showAddAudioRecord();
      setStatus(recordStatus, 'Recording is not supported in this browser.', 'dead');
      recordStartBtn.disabled = true;
      return;
    }
    recordMimeType = pickRecorderMime();
    if (!recordMimeType) {
      showAddAudioRecord();
      setStatus(recordStatus, 'No supported audio format for recording.', 'dead');
      recordStartBtn.disabled = true;
      return;
    }
    showAddAudioRecord();
  });

  recordBackBtn.addEventListener('click', function () {
    cleanupRecording();
    showAddAudioChoice();
  });

  recordStartBtn.addEventListener('click', function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus(recordStatus, 'Microphone access is not available.', 'dead');
      return;
    }
    recordStartBtn.disabled = true;
    setStatus(recordStatus, 'Requesting microphone…', 'muted');
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        mediaStream = stream;
        recordedChunks = [];
        var options = recordMimeType ? { mimeType: recordMimeType } : undefined;
        mediaRecorder = new MediaRecorder(stream, options);
        recordMimeType = mediaRecorder.mimeType || recordMimeType || 'audio/webm';
        mediaRecorder.ondataavailable = function (e) {
          if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data);
          }
        };
        mediaRecorder.onstop = function () {
          var blob = new Blob(recordedChunks, { type: recordMimeType });
          cleanupRecording();
          if (!blob.size) {
            openAddAudioModal();
            showAddAudioRecord();
            setStatus(recordStatus, 'Recording was empty — try again', 'dead');
            return;
          }
          var file = new File([blob], recordingFilename(), { type: recordMimeType });
          startFileImport([file]);
        };
        mediaRecorder.onerror = function () {
          cleanupRecording();
          setStatus(recordStatus, 'Recording failed', 'dead');
        };
        mediaRecorder.start();
        recordStartBtn.hidden = true;
        recordStopBtn.hidden = false;
        setStatus(recordStatus, 'Recording…', 'live');
      })
      .catch(function () {
        recordStartBtn.disabled = false;
        setStatus(recordStatus, 'Microphone permission denied or unavailable.', 'dead');
      });
  });

  recordStopBtn.addEventListener('click', function () {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      recordStopBtn.disabled = true;
      setStatus(recordStatus, 'Finishing…', 'muted');
      mediaRecorder.stop();
    }
  });

  fileInput.addEventListener('change', function () {
    if (!currentId || !fileInput.files.length) {
      return;
    }
    var files = fileInput.files;
    fileInput.value = '';
    startFileImport(files);
  });

  volumeSlider.addEventListener('input', function () {
    var level = Number(volumeSlider.value);
    volumeValue.textContent = formatVolume(level);
    queueVolumeSave(level);
  });

  trackList.setAttribute('aria-label', 'Tracks, drag to reorder');
  setupTrackListPointerReorder();

  refreshCardList();
  loadVolume();
  refreshPlaybackState();
  startPlaybackPoll();
})();
