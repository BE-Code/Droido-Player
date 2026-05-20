(function () {
  var cardSelect = document.getElementById('card-select');
  var scanBtn = document.getElementById('scan-btn');
  var scanStatus = document.getElementById('scan-status');
  var editorPanel = document.getElementById('editor-panel');
  var cardIdEl = document.getElementById('card-id');
  var cardTitleEl = document.getElementById('card-title');
  var saveBtn = document.getElementById('save-btn');
  var playCardBtn = document.getElementById('play-card-btn');
  var editorStatus = document.getElementById('editor-status');
  var playbackBackBtn = document.getElementById('playback-back-btn');
  var playbackPlayPauseBtn = document.getElementById('playback-play-pause-btn');
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
  var importCancelBtn = document.getElementById('import-cancel-btn');
  var segmentBtns = importModal.querySelectorAll('.segmented-btn');
  var volumeSlider = document.getElementById('volume-slider');
  var volumeValue = document.getElementById('volume-value');

  var currentId = null;
  var tracks = [];
  var missing = [];
  var dirty = false;
  var importQueue = [];
  var importTotal = 0;
  var currentStaging = null;
  var selectedVariant = 'original';
  var normalizedUrl = null;
  var normalizeInFlight = null;
  var mediaStream = null;
  var mediaRecorder = null;
  var recordedChunks = [];
  var recordMimeType = '';
  var volumeSaveTimer = null;
  var playbackPollTimer = null;
  var playbackActive = false;
  var playbackPaused = true;

  function setStatus(el, text, kind) {
    el.textContent = text || '';
    el.className = kind || 'muted';
    el.hidden = !text;
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

  function markDirty() {
    dirty = true;
    setStatus(editorStatus, 'Unsaved changes', 'live');
  }

  function clearDirty() {
    dirty = false;
    setStatus(editorStatus, 'Saved', 'muted');
  }

  function optionLabel(card) {
    var label = card.title ? card.title + ' — ' : '';
    return label + card.id;
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
      li.draggable = true;
      li.dataset.index = String(index);

      var nameSpan = document.createElement('span');
      nameSpan.className = 'track-name';
      nameSpan.textContent = name;
      li.appendChild(nameSpan);

      var actions = document.createElement('span');
      actions.className = 'track-actions';

      var upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'icon-btn';
      upBtn.textContent = '↑';
      upBtn.title = 'Move up';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', function () {
        moveTrack(index, index - 1);
      });

      var downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'icon-btn';
      downBtn.textContent = '↓';
      downBtn.title = 'Move down';
      downBtn.disabled = index === tracks.length - 1;
      downBtn.addEventListener('click', function () {
        moveTrack(index, index + 1);
      });

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'icon-btn danger';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove from playlist';
      removeBtn.addEventListener('click', function () {
        tracks.splice(index, 1);
        missing = missing.filter(function (m) { return tracks.indexOf(m) >= 0; });
        markDirty();
        renderTracks();
      });

      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(removeBtn);
      li.appendChild(actions);

      li.addEventListener('dragstart', onDragStart);
      li.addEventListener('dragover', onDragOver);
      li.addEventListener('drop', onDrop);
      li.addEventListener('dragend', onDragEnd);

      trackList.appendChild(li);
    });
  }

  var dragFrom = null;

  function onDragStart(e) {
    dragFrom = Number(e.currentTarget.dataset.index);
    e.currentTarget.classList.add('dragging');
  }

  function onDragOver(e) {
    e.preventDefault();
  }

  function onDrop(e) {
    e.preventDefault();
    var to = Number(e.currentTarget.dataset.index);
    if (dragFrom === null || dragFrom === to) {
      return;
    }
    moveTrack(dragFrom, to);
    dragFrom = null;
  }

  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    dragFrom = null;
  }

  function moveTrack(from, to) {
    if (to < 0 || to >= tracks.length) {
      return;
    }
    var item = tracks.splice(from, 1)[0];
    tracks.splice(to, 0, item);
    markDirty();
    renderTracks();
  }

  function openCard(id) {
    currentId = id;
    return fetch('/api/cards/' + encodeURIComponent(id))
      .then(function (res) {
        if (!res.ok) {
          throw new Error('load failed');
        }
        return res.json();
      })
      .then(function (card) {
        cardIdEl.textContent = card.id;
        cardTitleEl.value = card.title || '';
        tracks = card.tracks.slice();
        missing = card.missing || [];
        dirty = false;
        editorPanel.hidden = false;
        renderTracks();
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

  function save() {
    if (!currentId) {
      return Promise.resolve();
    }
    saveBtn.disabled = true;
    return fetch('/api/cards/' + encodeURIComponent(currentId), {
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
        clearDirty();
        return refreshCardList(currentId);
      })
      .catch(function () {
        setStatus(editorStatus, 'Save failed', 'dead');
      })
      .finally(function () {
        saveBtn.disabled = false;
      });
  }

  function updatePlayPauseUi() {
    if (playbackActive && !playbackPaused) {
      playbackPlayPauseBtn.textContent = '⏸';
      playbackPlayPauseBtn.title = 'Pause';
      playbackPlayPauseBtn.setAttribute('aria-label', 'Pause');
      playbackPlayPauseBtn.disabled = false;
    } else if (playbackActive && playbackPaused) {
      playbackPlayPauseBtn.textContent = '▶';
      playbackPlayPauseBtn.title = 'Resume';
      playbackPlayPauseBtn.setAttribute('aria-label', 'Resume');
      playbackPlayPauseBtn.disabled = false;
    } else {
      playbackPlayPauseBtn.textContent = '▶';
      playbackPlayPauseBtn.title = 'Nothing playing';
      playbackPlayPauseBtn.setAttribute('aria-label', 'Nothing playing');
      playbackPlayPauseBtn.disabled = true;
    }
  }

  function applyPlaybackState(data) {
    playbackActive = !!(data && data.active);
    playbackPaused = !playbackActive || !!(data && data.paused);
    updatePlayPauseUi();
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
        playbackPaused = true;
        updatePlayPauseUi();
      });
  }

  function startPlaybackPoll() {
    if (playbackPollTimer) {
      return;
    }
    playbackPollTimer = setInterval(refreshPlaybackState, 2000);
  }

  function playCard() {
    if (!currentId) {
      setStatus(editorStatus, 'Open a card first', 'dead');
      return Promise.reject(new Error('no card'));
    }
    if (dirty) {
      setStatus(editorStatus, 'Save first — play uses the saved playlist only', 'dead');
      return Promise.reject(new Error('unsaved'));
    }
    playCardBtn.disabled = true;
    return fetch('/api/cards/' + encodeURIComponent(currentId) + '/play', {
      method: 'POST',
    })
      .then(function (res) {
        if (!res.ok && res.status !== 204) {
          throw new Error('play failed');
        }
        setStatus(editorStatus, 'Playing card…', 'live');
        playbackActive = true;
        playbackPaused = false;
        updatePlayPauseUi();
        startPlaybackPoll();
        return refreshPlaybackState();
      })
      .catch(function () {
        setStatus(editorStatus, 'Play failed', 'dead');
        throw new Error('play failed');
      })
      .finally(function () {
        playCardBtn.disabled = false;
      });
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
    if (!playbackActive) {
      return;
    }
    if (!playbackPaused) {
      postPlayback('/api/pause')
        .then(function () {
          setStatus(playbackStatus, 'Paused', 'muted');
        })
        .catch(function (err) {
          setStatus(playbackStatus, err.message || 'Pause failed', 'dead');
        });
      return;
    }
    postPlayback('/api/resume')
      .then(function () {
        setStatus(playbackStatus, 'Playing…', 'live');
      })
      .catch(function (err) {
        setStatus(playbackStatus, err.message || 'Resume failed', 'dead');
      });
  }

  cardSelect.addEventListener('change', function () {
    var id = cardSelect.value;
    if (!id) {
      editorPanel.hidden = true;
      currentId = null;
      return;
    }
    openCard(id).catch(function () {
      setStatus(editorStatus, 'Could not load card', 'dead');
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
        return refreshCardList(data.id).then(function () {
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

  cardTitleEl.addEventListener('input', markDirty);

  saveBtn.addEventListener('click', save);
  playCardBtn.addEventListener('click', function () {
    playCard().catch(function () {});
  });

  playbackBackBtn.addEventListener('click', function () {
    postPlayback('/api/back')
      .then(function () {
        setStatus(playbackStatus, 'Previous track', 'muted');
      })
      .catch(function (err) {
        setStatus(playbackStatus, err.message || 'Skip back failed', 'dead');
      });
  });

  playbackForwardBtn.addEventListener('click', function () {
    postPlayback('/api/forward')
      .then(function () {
        setStatus(playbackStatus, 'Next track', 'muted');
      })
      .catch(function (err) {
        setStatus(playbackStatus, err.message || 'Skip forward failed', 'dead');
      });
  });

  playbackPlayPauseBtn.addEventListener('click', togglePlayPause);

  function setImportStatus(text, kind) {
    setStatus(importStatus, text, kind);
  }

  function updateSegmentUi() {
    segmentBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.variant === selectedVariant);
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
    normalizedUrl = null;
    selectedVariant = 'original';
    normalizeInFlight = null;
    updateSegmentUi();
    setImportStatus('', 'muted');
    importSaveBtn.disabled = false;
    segmentBtns.forEach(function (btn) { btn.disabled = false; });
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

  function splitFileName(name) {
    var i = name.lastIndexOf('.');
    if (i <= 0) {
      return { stem: name, ext: '' };
    }
    return { stem: name.slice(0, i), ext: name.slice(i) };
  }

  function openImportModal(staging, queueIndex, queueTotal) {
    currentStaging = staging;
    selectedVariant = 'original';
    normalizedUrl = staging.normalizedUrl || null;
    var parts = splitFileName(staging.originalName);
    importFileStem.value = parts.stem;
    importFileExt.textContent = parts.ext || '';
    importFileExt.hidden = !parts.ext;
    importFilenameHint.textContent = parts.ext
      ? 'Extension stays the same; edit the name before it.'
      : 'Edit the file name (no extension on this file).';
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
    importSaveBtn.disabled = false;
  }

  function processImportQueue() {
    if (!importQueue.length) {
      importTotal = 0;
      setStatus(editorStatus, 'Done adding files — save playlist when ready', 'muted');
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
      if (variant === 'normalized') {
        importSaveBtn.disabled = true;
        segmentBtns.forEach(function (b) { b.disabled = true; });
        setImportStatus('Processing normalization…', 'live');
        ensureNormalized()
          .then(function () {
            selectedVariant = 'normalized';
            updateSegmentUi();
            updateImportAudioSrc();
            setImportStatus('', 'muted');
          })
          .catch(function (err) {
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
            importSaveBtn.disabled = selectedVariant === 'normalized' && !normalizedUrl;
            segmentBtns.forEach(function (b) { b.disabled = false; });
          });
        return;
      }
      selectedVariant = 'original';
      updateSegmentUi();
      updateImportAudioSrc();
      setImportStatus('', 'muted');
      importSaveBtn.disabled = false;
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
    importSaveBtn.disabled = true;
    importCancelBtn.disabled = true;
    setImportStatus('Saving…', 'live');
    fetch(
      '/api/cards/' + encodeURIComponent(currentId) +
        '/staging/' + encodeURIComponent(currentStaging.stagingId) + '/commit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          choice: selectedVariant,
          originalName: currentStaging.originalName,
          fileStem: importFileStem.value,
        }),
      }
    )
      .then(function (res) {
        if (!res.ok) {
          throw new Error('commit failed');
        }
        return res.json();
      })
      .then(function (data) {
        if (tracks.indexOf(data.filename) < 0) {
          tracks.push(data.filename);
        }
        markDirty();
        renderTracks();
        finishImportAndNext();
        importCancelBtn.disabled = false;
      })
      .catch(function () {
        setImportStatus('Save failed', 'dead');
        importSaveBtn.disabled = false;
        importCancelBtn.disabled = false;
      });
  });

  importCancelBtn.addEventListener('click', function () {
    if (!currentStaging) {
      closeImportModal();
      processImportQueue();
      return;
    }
    var stagingId = currentStaging.stagingId;
    importCancelBtn.disabled = true;
    discardStaging(stagingId).finally(function () {
      finishImportAndNext();
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

  refreshCardList();
  loadVolume();
  refreshPlaybackState();
  startPlaybackPoll();
})();
