(function () {
  var cardSelect = document.getElementById('card-select');
  var scanBtn = document.getElementById('scan-btn');
  var scanStatus = document.getElementById('scan-status');
  var editorPanel = document.getElementById('editor-panel');
  var cardIdEl = document.getElementById('card-id');
  var cardTitleEl = document.getElementById('card-title');
  var saveBtn = document.getElementById('save-btn');
  var playBtn = document.getElementById('play-btn');
  var stopBtn = document.getElementById('stop-btn');
  var editorStatus = document.getElementById('editor-status');
  var tracksEmpty = document.getElementById('tracks-empty');
  var trackList = document.getElementById('track-list');
  var fileInput = document.getElementById('file-input');
  var importModal = document.getElementById('import-modal');
  var importQueueLabel = document.getElementById('import-queue-label');
  var importFilename = document.getElementById('import-filename');
  var importAudio = document.getElementById('import-audio');
  var importStatus = document.getElementById('import-status');
  var importSaveBtn = document.getElementById('import-save-btn');
  var importCancelBtn = document.getElementById('import-cancel-btn');
  var segmentBtns = importModal.querySelectorAll('.segmented-btn');

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

  function setStatus(el, text, kind) {
    el.textContent = text || '';
    el.className = kind || 'muted';
    el.hidden = !text;
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

  function playCard() {
    if (!currentId) {
      return;
    }
    if (dirty) {
      setStatus(editorStatus, 'Save first — play uses the saved playlist only', 'dead');
      return;
    }
    fetch('/api/cards/' + encodeURIComponent(currentId) + '/play', {
      method: 'POST',
    })
      .then(function (res) {
        if (!res.ok && res.status !== 204) {
          throw new Error('play failed');
        }
        setStatus(editorStatus, 'Playing…', 'live');
      })
      .catch(function () {
        setStatus(editorStatus, 'Play failed', 'dead');
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
  playBtn.addEventListener('click', playCard);

  stopBtn.addEventListener('click', function () {
    fetch('/api/stop', { method: 'POST' })
      .then(function () {
        setStatus(editorStatus, 'Stopped', 'muted');
      })
      .catch(function () {
        setStatus(editorStatus, 'Stop failed', 'dead');
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

  function openImportModal(staging, queueIndex, queueTotal) {
    currentStaging = staging;
    selectedVariant = 'original';
    normalizedUrl = staging.normalizedUrl || null;
    importFilename.textContent = staging.originalName;
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

  fileInput.addEventListener('change', function () {
    if (!currentId || !fileInput.files.length) {
      return;
    }
    importQueue = Array.prototype.slice.call(fileInput.files);
    importTotal = importQueue.length;
    fileInput.value = '';
    processImportQueue();
  });

  refreshCardList();
})();
