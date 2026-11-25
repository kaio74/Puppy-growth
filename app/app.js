(function () {
  'use strict';

  const Projections = window.PuppyProjections;
  const Storage = window.PuppyStorage;
  const UIHelpers = window.PuppyUIHelpers;

  const MODEL_DASH_MAP = {
    gompertz: 'dash',
    brody: 'dot',
    logistic: 'dashdot',
    richards: 'longdash',
    percentile: 'longdashdot',
  };

  const MAX_UNDO = 40;

  const state = {
    project: null,
    selectedPuppyId: null,
    isDirty: false,
    fileHandle: null,
    fileName: null,
    undoStack: [],
    editingPuppyId: null,
    editingMeasurement: null, // { puppyId, measurementId }
    confirmResolver: null,
  };

  let toast = null;
  let formA11y = null;
  let darkModeMql = null;

  // DOM References
  const els = {};

  function cacheElements() {
    els.projectNameInput = document.getElementById('project-name-input');
    els.statusPill = document.getElementById('status-pill');
    els.btnUndo = document.getElementById('btn-undo');
    els.btnNew = document.getElementById('btn-new');
    els.btnOpen = document.getElementById('btn-open');
    els.btnSave = document.getElementById('btn-save');
    els.btnSaveAs = document.getElementById('btn-save-as');
    els.btnRange = document.getElementById('btn-range');

    els.projectionModelSelect = document.getElementById('projection-model-select');
    els.toggleTypicalRange = document.getElementById('toggle-typical-range');
    els.toggleProjections = document.getElementById('toggle-projections');
    els.toggleConfidenceBand = document.getElementById('toggle-confidence-band');
    els.toggleVelocityChart = document.getElementById('toggle-velocity-chart');
    els.btnExportCsv = document.getElementById('btn-export-csv');
    els.btnResetStarter = document.getElementById('btn-reset-starter');
    els.growthChart = document.getElementById('growth-chart');
    els.velocityPanel = document.getElementById('velocity-panel');
    els.velocityChart = document.getElementById('velocity-chart');
    els.summaryGrid = document.getElementById('summary-grid');

    els.btnAddPuppy = document.getElementById('btn-add-puppy');
    els.btnEditPuppy = document.getElementById('btn-edit-puppy');
    els.puppyPills = document.getElementById('puppy-pills');

    els.addMeasurementForm = document.getElementById('add-measurement-form');
    els.mPuppy = document.getElementById('m-puppy');
    els.mWeek = document.getElementById('m-week');
    els.mHeight = document.getElementById('m-height');
    els.mNote = document.getElementById('m-note');
    els.btnSubmitMeasurement = document.getElementById('btn-submit-measurement');

    els.tableCaption = document.getElementById('measurements-table-caption');
    els.measurementsTbody = document.getElementById('measurements-tbody');
    els.fileOpenInput = document.getElementById('file-open-input');
    els.dropOverlay = document.getElementById('drop-overlay');

    // Dialogs
    els.puppyDialog = document.getElementById('puppy-dialog');
    els.puppyDialogTitle = document.getElementById('puppy-dialog-title');
    els.puppyDialogForm = document.getElementById('puppy-dialog-form');
    els.puppyNameInput = document.getElementById('puppy-name-input');
    els.puppyColorInput = document.getElementById('puppy-color-input');
    els.puppyColorSwatches = document.getElementById('puppy-color-swatches');

    els.measurementDialog = document.getElementById('measurement-dialog');
    els.measurementDialogForm = document.getElementById('measurement-dialog-form');
    els.editMWeek = document.getElementById('edit-m-week');
    els.editMHeight = document.getElementById('edit-m-height');
    els.editMNote = document.getElementById('edit-m-note');

    els.referenceDialog = document.getElementById('reference-dialog');
    els.referenceDialogForm = document.getElementById('reference-dialog-form');
    els.rangeLabelInput = document.getElementById('range-label-input');
    els.rangeRowsContainer = document.getElementById('range-rows-container');
    els.btnAddRangeRow = document.getElementById('btn-add-range-row');
    els.btnResetRangeDefault = document.getElementById('btn-reset-range-default');

    els.confirmDialog = document.getElementById('confirm-dialog');
    els.confirmTitle = document.getElementById('confirm-dialog-title');
    els.confirmMessage = document.getElementById('confirm-dialog-message');
    els.confirmOkBtn = document.getElementById('confirm-ok-btn');
  }

  function getSelectedPuppy() {
    if (!state.project || state.project.puppies.length === 0) return null;
    const found = state.project.puppies.find((p) => p.id === state.selectedPuppyId);
    if (found) return found;
    state.selectedPuppyId = state.project.puppies[0].id;
    return state.project.puppies[0];
  }

  function pushUndoSnapshot() {
    state.undoStack.push({
      project: Storage.cloneDeep(state.project),
      selectedPuppyId: state.selectedPuppyId,
    });
    if (state.undoStack.length > MAX_UNDO) {
      state.undoStack.shift();
    }
    els.btnUndo.disabled = state.undoStack.length === 0;
  }

  function markDirty(dirty = true) {
    state.isDirty = dirty;
    Storage.saveAutosave(state.project);
    updateHeaderStatus();
  }

  function updateHeaderStatus() {
    els.projectNameInput.value = state.project.name;
    els.statusPill.dataset.dirty = state.isDirty ? 'true' : 'false';
    if (state.isDirty) {
      els.statusPill.textContent = state.fileName ? `Unsaved • ${state.fileName}` : 'Unsaved changes';
    } else {
      els.statusPill.textContent = state.fileName ? `Saved • ${state.fileName}` : 'Saved';
    }
    els.btnUndo.disabled = state.undoStack.length === 0;
    els.projectionModelSelect.value = state.project.settings.projectionModel || 'gompertz';
    els.toggleTypicalRange.checked = state.project.settings.showTypicalRange;
    els.toggleProjections.checked = state.project.settings.showProjections;
    els.toggleConfidenceBand.checked = state.project.settings.showConfidenceBand === true;
    els.toggleVelocityChart.checked = state.project.settings.showVelocityChart === true;
  }

  function confirmAction({ title, message, confirmLabel = 'Confirm', danger = true }) {
    return new Promise((resolve) => {
      state.confirmResolver = resolve;
      els.confirmTitle.textContent = title;
      els.confirmMessage.textContent = message;
      els.confirmOkBtn.textContent = confirmLabel;
      els.confirmOkBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
      els.confirmDialog.returnValue = '';
      els.confirmDialog.showModal();
    });
  }

  function performUndo() {
    if (state.undoStack.length === 0) return;
    const snap = state.undoStack.pop();
    state.project = snap.project;
    state.selectedPuppyId = snap.selectedPuppyId;
    markDirty(true);
    renderAll();
    toast.show('Reverted last change.', { variant: 'info' });
  }

  // --- Rendering ---

  function renderPuppyControls() {
    const puppies = state.project.puppies;
    const selected = getSelectedPuppy();

    els.btnEditPuppy.disabled = !selected;

    // Pills
    els.puppyPills.textContent = '';
    if (puppies.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'summary-note';
      empty.textContent = 'No puppies yet. Click "+ Add Puppy" to begin.';
      els.puppyPills.append(empty);
    } else {
      for (const pup of puppies) {
        const isSelected = Boolean(selected && selected.id === pup.id);

        const group = document.createElement('div');
        group.className = 'puppy-pill-group';
        group.dataset.selected = String(isSelected);

        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'puppy-pill-select';
        selectBtn.setAttribute('aria-pressed', String(isSelected));

        const dot = document.createElement('span');
        dot.className = 'color-dot';
        dot.style.backgroundColor = pup.color;

        const label = document.createElement('span');
        label.textContent = `${pup.name} (${pup.measurements.length})`;

        selectBtn.append(dot, label);
        selectBtn.addEventListener('click', () => {
          state.selectedPuppyId = pup.id;
          renderAll();
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'puppy-pill-remove';
        removeBtn.textContent = '×';
        removeBtn.setAttribute('aria-label', `Remove ${pup.name}`);
        removeBtn.title = `Remove ${pup.name}`;
        removeBtn.addEventListener('click', () => deletePuppy(pup.id));

        group.append(selectBtn, removeBtn);
        els.puppyPills.append(group);
      }
    }

    // Select dropdown in Add Measurement form
    els.mPuppy.textContent = '';
    if (puppies.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Add a puppy first…';
      els.mPuppy.append(opt);
      els.mPuppy.disabled = true;
      els.btnSubmitMeasurement.disabled = true;
    } else {
      els.mPuppy.disabled = false;
      els.btnSubmitMeasurement.disabled = false;
      for (const pup of puppies) {
        const opt = document.createElement('option');
        opt.value = pup.id;
        opt.textContent = pup.name;
        if (selected && selected.id === pup.id) opt.selected = true;
        els.mPuppy.append(opt);
      }
    }
  }

  function renderMeasurementsTable() {
    const selected = getSelectedPuppy();
    els.measurementsTbody.textContent = '';

    if (!selected) {
      els.tableCaption.textContent = 'Measurements';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'empty-table-msg';
      td.textContent = 'Add a puppy to record measurements.';
      tr.append(td);
      els.measurementsTbody.append(tr);
      return;
    }

    els.tableCaption.textContent = `${selected.name} — Measurements (${selected.measurements.length})`;

    if (selected.measurements.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'empty-table-msg';
      td.textContent = `No measurements yet for ${selected.name}. Use the form above to add one.`;
      tr.append(td);
      els.measurementsTbody.append(tr);
      return;
    }

    const rows = selected.measurements;
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i];
      const prev = i > 0 ? rows[i - 1] : null;
      const tr = document.createElement('tr');

      const thWeek = document.createElement('th');
      thWeek.scope = 'row';
      thWeek.textContent = `Wk ${m.week}`;

      const tdHeight = document.createElement('td');
      tdHeight.className = 'cell-num';
      const heightMain = document.createElement('span');
      heightMain.textContent = `${Number(m.height.toFixed(2))} cm`;
      tdHeight.append(heightMain);
      if (m.note) {
        const noteSpan = document.createElement('span');
        noteSpan.className = 'cell-note';
        noteSpan.textContent = m.note;
        tdHeight.append(noteSpan);
      }

      const tdDelta = document.createElement('td');
      tdDelta.className = 'cell-num';
      if (prev) {
        const diff = m.height - prev.height;
        const sign = diff >= 0 ? '+' : '';
        tdDelta.textContent = `${sign}${diff.toFixed(2)} cm`;
      } else {
        tdDelta.textContent = '—';
      }

      const tdActions = document.createElement('td');
      const actWrap = document.createElement('div');
      actWrap.className = 'row-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-sm';
      editBtn.textContent = 'Edit';
      editBtn.setAttribute('aria-label', `Edit week ${m.week} measurement for ${selected.name}`);
      editBtn.addEventListener('click', () => openEditMeasurementDialog(selected.id, m.id));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-sm btn-subtle';
      delBtn.textContent = 'Delete';
      delBtn.setAttribute('aria-label', `Delete week ${m.week} measurement for ${selected.name}`);
      delBtn.addEventListener('click', () => deleteMeasurement(selected.id, m.id));

      actWrap.append(editBtn, delBtn);
      tdActions.append(actWrap);

      tr.append(thWeek, tdHeight, tdDelta, tdActions);
      els.measurementsTbody.append(tr);
    }
  }

  function hexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return `rgba(37, 99, 235, ${alpha})`;
    const clean = hex.replace('#', '').trim();
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(37, 99, 235, ${alpha})`;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function getActiveFitForPuppy(analysis, mode) {
    if (!analysis) return null;
    if (mode === 'compare') {
      const id = analysis.bestModelId || 'gompertz';
      return analysis.models[id] || analysis.models.percentile || null;
    }
    return analysis.models[mode] || null;
  }

  function renderSummaryCards(analysesByPuppyId) {
    els.summaryGrid.textContent = '';
    const puppies = state.project.puppies;
    if (puppies.length === 0) return;

    const selected = getSelectedPuppy();
    const activeModel = state.project.settings.projectionModel || 'gompertz';

    for (const pup of puppies) {
      const card = document.createElement('article');
      card.className = 'summary-card';
      card.dataset.selected = String(selected && selected.id === pup.id);

      const analysis = analysesByPuppyId.get(pup.id);
      const fit = getActiveFitForPuppy(analysis, activeModel);
      const milestones = Projections.computeMilestones(
        pup.measurements,
        fit,
        state.project.typicalRange
      );

      const top = document.createElement('div');
      top.className = 'summary-card-top';

      const ident = document.createElement('div');
      ident.className = 'puppy-identity';
      const dot = document.createElement('span');
      dot.className = 'color-dot';
      dot.style.backgroundColor = pup.color;
      const nameSpan = document.createElement('span');
      nameSpan.textContent = pup.name;
      ident.append(dot, nameSpan);

      if (milestones.breedCheck) {
        const badge = document.createElement('span');
        badge.className = 'breed-badge';
        badge.dataset.status = milestones.breedCheck.status;
        badge.textContent = milestones.breedCheck.label;
        badge.title = `Week 52 typical band: ${milestones.breedCheck.lower52.toFixed(1)}–${milestones.breedCheck.upper52.toFixed(1)} cm`;
        ident.append(badge);
      }

      const visLabel = document.createElement('label');
      visLabel.className = 'toggle-label';
      visLabel.style.fontSize = '0.78rem';
      const visChk = document.createElement('input');
      visChk.type = 'checkbox';
      visChk.checked = pup.visible !== false;
      visChk.addEventListener('change', () => {
        pushUndoSnapshot();
        pup.visible = visChk.checked;
        markDirty(true);
        renderChart();
        renderVelocityChart();
      });
      visLabel.append(visChk, document.createTextNode('Visible'));

      top.append(ident, visLabel);

      const stats = document.createElement('div');
      stats.className = 'summary-stats';

      const latest = pup.measurements.length > 0 ? pup.measurements[pup.measurements.length - 1] : null;

      const addStat = (label, value) => {
        const item = document.createElement('div');
        item.className = 'stat-item';
        const l = document.createElement('span');
        l.className = 'stat-label';
        l.textContent = label;
        const v = document.createElement('span');
        v.className = 'stat-value';
        v.textContent = value;
        item.append(l, v);
        stats.append(item);
      };

      addStat(
        'Latest',
        latest ? `${latest.height} cm @ wk ${latest.week} (${pup.measurements.length})` : `0 pts`
      );
      addStat(
        fit ? `Wk 52 (${fit.shortLabel})` : 'Est. Week 52',
        fit ? `${fit.projectedWeek52.toFixed(1)} cm` : '—'
      );

      if (milestones.percentAdult != null) {
        const rateStr =
          milestones.currentVelocity != null ? `${milestones.currentVelocity.toFixed(2)} cm/wk` : '';
        addStat(
          '% Adult / Rate',
          rateStr ? `${milestones.percentAdult.toFixed(1)}% · ${rateStr}` : `${milestones.percentAdult.toFixed(1)}%`
        );
      } else {
        addStat('% Adult / Rate', '—');
      }

      if (fit && fit.id === 'percentile') {
        addStat('Band Position', `${Math.round(fit.percentilePos * 100)}%`);
      } else if (fit && (fit.week95 != null || fit.week99 != null)) {
        const w95 = fit.week95 != null ? `wk ${Math.round(fit.week95)}` : '—';
        const w99 = fit.week99 != null ? `wk ${Math.round(fit.week99)}` : '—';
        addStat('Plateau (95% / 99%)', `${w95} / ${w99}`);
      } else {
        addStat('Asymptote / R²', fit && fit.a ? `${fit.a.toFixed(1)} cm (${fit.rSquared.toFixed(3)})` : '—');
      }

      const note = document.createElement('div');
      note.className = 'summary-note';
      if (pup.measurements.length === 0) {
        note.textContent = 'Add measurements to calculate growth projections.';
      } else if (!fit && pup.measurements.length < 4 && activeModel !== 'percentile') {
        note.textContent = `Add ${4 - pup.measurements.length} more measurement(s) for ${activeModel} fit, or switch Model to Percentile Track (works with 1+ pts).`;
      } else if (!fit) {
        note.textContent = `Selected model (${activeModel}) unavailable for current data spread.`;
      } else if (analysis && analysis.consensus) {
        const bestM = analysis.models[analysis.bestModelId];
        note.textContent = `Model range: ${analysis.consensus.minWeek52.toFixed(1)}–${analysis.consensus.maxWeek52.toFixed(1)} cm · Best fit: ${bestM ? bestM.shortLabel : '—'} (R² ${fit.rSquared.toFixed(3)})`;
      } else {
        note.textContent = `${fit.shortLabel} RMSE: ${fit.rmse.toFixed(2)} cm (R² ${fit.rSquared.toFixed(3)})`;
      }

      card.append(top, stats, note);

      // Expandable model comparison table when at least one model fits
      const modelOrder = ['gompertz', 'brody', 'logistic', 'richards', 'percentile'];
      const fittedList = analysis
        ? modelOrder.map((id) => analysis.models[id]).filter(Boolean)
        : [];
      if (fittedList.length > 0) {
        const details = document.createElement('details');
        details.className = 'model-compare-details';
        const summary = document.createElement('summary');
        summary.textContent = `Compare models (${fittedList.length})`;
        details.append(summary);

        const tbl = document.createElement('table');
        tbl.className = 'model-compare-table';
        const thead = document.createElement('thead');
        const hr = document.createElement('tr');
        for (const col of ['Model', 'Wk 52', 'Asymp.', 'R²', 'AICc']) {
          const th = document.createElement('th');
          th.scope = 'col';
          th.textContent = col;
          hr.append(th);
        }
        thead.append(hr);

        const tbody = document.createElement('tbody');
        for (const m of fittedList) {
          const tr = document.createElement('tr');

          const tdName = document.createElement('td');
          tdName.textContent = m.shortLabel;
          if (analysis.bestModelId === m.id) {
            const bestTag = document.createElement('span');
            bestTag.className = 'best-tag';
            bestTag.textContent = 'Best';
            tdName.append(bestTag);
          }

          const tdW52 = document.createElement('td');
          tdW52.textContent = `${m.projectedWeek52.toFixed(1)}`;

          const tdA = document.createElement('td');
          tdA.textContent = m.a != null ? `${m.a.toFixed(1)}` : '—';

          const tdR2 = document.createElement('td');
          tdR2.textContent = m.rSquared.toFixed(3);

          const tdAic = document.createElement('td');
          tdAic.textContent = m.aicc != null ? m.aicc.toFixed(1) : '—';

          tr.append(tdName, tdW52, tdA, tdR2, tdAic);
          tbody.append(tr);
        }
        tbl.append(thead, tbody);
        details.append(tbl);
        card.append(details);
      }

      const actions = document.createElement('div');
      actions.className = 'summary-actions';

      const leftBtns = document.createElement('div');
      leftBtns.style.display = 'flex';
      leftBtns.style.gap = '0.35rem';

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'btn btn-sm btn-subtle';
      selectBtn.textContent = selected && selected.id === pup.id ? 'Selected' : 'Select';
      selectBtn.addEventListener('click', () => {
        state.selectedPuppyId = pup.id;
        renderAll();
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-sm';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openPuppyDialog(pup));

      leftBtns.append(selectBtn, editBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-sm btn-subtle';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deletePuppy(pup.id));

      actions.append(leftBtns, delBtn);

      card.append(actions);
      els.summaryGrid.append(card);
    }
  }

  function computeAnalyses() {
    const map = new Map();
    for (const pup of state.project.puppies) {
      map.set(pup.id, Projections.analyzePuppy(pup.measurements, state.project.typicalRange));
    }
    return map;
  }

  function addConfidenceBandTraces(traces, pup, fit) {
    if (!fit || !fit.ci95) return;
    traces.push({
      x: fit.curve.x,
      y: fit.ci95.upper,
      mode: 'lines',
      line: { width: 0 },
      showlegend: false,
      hoverinfo: 'skip',
      type: 'scatter',
    });
    traces.push({
      x: fit.curve.x,
      y: fit.ci95.lower,
      mode: 'lines',
      line: { width: 0 },
      fill: 'tonexty',
      fillcolor: hexToRgba(pup.color, 0.14),
      name: `${pup.name} 95% CI (${fit.shortLabel})`,
      hoverinfo: 'skip',
      type: 'scatter',
    });
  }

  function renderChart(analysesByPuppyId) {
    if (!window.Plotly) return;
    const analyses = analysesByPuppyId || computeAnalyses();
    const traces = [];
    const { typicalRange, settings, puppies, name } = state.project;
    const modelMode = settings.projectionModel || 'gompertz';

    if (settings.showTypicalRange && typicalRange && typicalRange.ageWeeks.length >= 2) {
      traces.push({
        x: typicalRange.ageWeeks,
        y: typicalRange.upperLimit,
        mode: 'lines',
        line: { width: 0 },
        showlegend: false,
        hoverinfo: 'skip',
        type: 'scatter',
      });
      traces.push({
        x: typicalRange.ageWeeks,
        y: typicalRange.lowerLimit,
        mode: 'lines',
        line: { width: 0 },
        fill: 'tonexty',
        fillcolor: 'rgba(0, 100, 80, 0.2)',
        name: typicalRange.label || 'Typical Height Range',
        type: 'scatter',
      });
    }

    for (const pup of puppies) {
      if (pup.visible === false || pup.measurements.length === 0) continue;

      const analysis = analyses.get(pup.id);

      if (settings.showProjections && settings.showConfidenceBand && analysis) {
        const ciFit = getActiveFitForPuppy(analysis, modelMode);
        addConfidenceBandTraces(traces, pup, ciFit);
      }

      const xs = pup.measurements.map((m) => m.week);
      const ys = pup.measurements.map((m) => m.height);
      const customText = pup.measurements.map((m) => (m.note ? `Note: ${m.note}` : ''));

      traces.push({
        x: xs,
        y: ys,
        text: customText,
        mode: 'lines+markers',
        marker: { color: pup.color, size: 8 },
        line: { color: pup.color, width: 3 },
        name: `${pup.name}'s Actual Growth`,
        type: 'scatter',
        hovertemplate: '%{y:.2f} cm%{text}<extra>' + pup.name + '</extra>',
      });

      if (settings.showProjections && analysis) {
        if (modelMode === 'compare') {
          for (const id of ['gompertz', 'brody', 'logistic', 'richards', 'percentile']) {
            const fit = analysis.models[id];
            if (!fit) continue;
            traces.push({
              x: fit.curve.x,
              y: fit.curve.y,
              mode: 'lines',
              line: { color: pup.color, width: 2, dash: MODEL_DASH_MAP[id] || 'dash' },
              name: `${pup.name} (${fit.shortLabel})`,
              type: 'scatter',
            });
          }
        } else {
          const fit = analysis.models[modelMode];
          if (fit) {
            const traceName =
              modelMode === 'gompertz'
                ? `${pup.name}'s Projected Growth Curve`
                : `${pup.name} — ${fit.shortLabel} Projection`;
            traces.push({
              x: fit.curve.x,
              y: fit.curve.y,
              mode: 'lines',
              line: { color: pup.color, width: 2, dash: MODEL_DASH_MAP[modelMode] || 'dash' },
              name: traceName,
              type: 'scatter',
            });
          }
        }
      }
    }

    const isDark = darkModeMql ? darkModeMql.matches : false;
    const modelTitleMap = {
      gompertz: 'Gompertz Projection',
      brody: 'Brody Projection',
      logistic: 'Logistic Projection',
      richards: 'Richards Projection',
      percentile: 'Percentile Track',
      compare: 'Model Comparison',
    };
    const titleSuffix = modelTitleMap[modelMode] || 'Gompertz Projection';

    const layout = {
      title: {
        text: name ? `${name} — ${titleSuffix}` : `Puppy Growth Chart — ${titleSuffix}`,
        font: { size: 17, color: isDark ? '#eef3fb' : '#162032' },
      },
      paper_bgcolor: isDark ? '#161f2e' : '#ffffff',
      plot_bgcolor: isDark ? '#1b2638' : '#f8fafd',
      font: {
        family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        color: isDark ? '#d8e2f1' : '#1e293b',
      },
      xaxis: {
        title: { text: 'Age (Weeks)' },
        gridcolor: isDark ? '#2b3a52' : '#e2e8f0',
        zerolinecolor: isDark ? '#3d5170' : '#cbd5e1',
      },
      yaxis: {
        title: { text: 'Height (cm)' },
        gridcolor: isDark ? '#2b3a52' : '#e2e8f0',
        zerolinecolor: isDark ? '#3d5170' : '#cbd5e1',
      },
      legend: {
        yanchor: 'top',
        y: 0.98,
        xanchor: 'left',
        x: 0.02,
        bgcolor: isDark ? 'rgba(22, 31, 46, 0.78)' : 'rgba(255, 255, 255, 0.82)',
      },
      hovermode: 'x unified',
      margin: { t: 54, r: 24, b: 56, l: 60 },
    };

    Plotly.react(els.growthChart, traces, layout, {
      responsive: true,
      displaylogo: false,
    });
  }

  function renderVelocityChart(analysesByPuppyId) {
    const showVel = state.project.settings.showVelocityChart === true;
    els.velocityPanel.hidden = !showVel;
    if (!showVel || !window.Plotly) return;

    const analyses = analysesByPuppyId || computeAnalyses();
    const modelMode = state.project.settings.projectionModel || 'gompertz';
    const traces = [];

    for (const pup of state.project.puppies) {
      if (pup.visible === false || pup.measurements.length === 0) continue;
      const analysis = analyses.get(pup.id);
      if (!analysis) continue;

      const fit = getActiveFitForPuppy(analysis, modelMode);
      if (fit && fit.velocityCurve) {
        traces.push({
          x: fit.velocityCurve.x,
          y: fit.velocityCurve.y,
          mode: 'lines',
          line: { color: pup.color, width: 2.5 },
          name: `${pup.name} (${fit.shortLabel} rate)`,
          type: 'scatter',
        });
      }

      if (analysis.observedVelocity.x.length > 0) {
        traces.push({
          x: analysis.observedVelocity.x,
          y: analysis.observedVelocity.y,
          mode: 'markers',
          marker: { color: pup.color, size: 7, opacity: 0.55 },
          name: `${pup.name} interval avg`,
          type: 'scatter',
        });
      }
    }

    const isDark = darkModeMql ? darkModeMql.matches : false;
    const layout = {
      paper_bgcolor: isDark ? '#161f2e' : '#ffffff',
      plot_bgcolor: isDark ? '#1b2638' : '#f8fafd',
      font: {
        family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        color: isDark ? '#d8e2f1' : '#1e293b',
      },
      xaxis: {
        title: { text: 'Age (Weeks)' },
        gridcolor: isDark ? '#2b3a52' : '#e2e8f0',
        zerolinecolor: isDark ? '#3d5170' : '#cbd5e1',
      },
      yaxis: {
        title: { text: 'Growth Rate (cm / week)' },
        rangemode: 'tozero',
        gridcolor: isDark ? '#2b3a52' : '#e2e8f0',
        zerolinecolor: isDark ? '#3d5170' : '#cbd5e1',
      },
      hovermode: 'x unified',
      margin: { t: 24, r: 24, b: 50, l: 60 },
    };

    Plotly.react(els.velocityChart, traces, layout, {
      responsive: true,
      displaylogo: false,
    });
  }

  function renderAll() {
    updateHeaderStatus();
    const analyses = computeAnalyses();
    renderPuppyControls();
    renderMeasurementsTable();
    renderSummaryCards(analyses);
    renderChart(analyses);
    renderVelocityChart(analyses);
  }

  // --- CRUD Operations ---

  function handleAddMeasurementSubmit(event) {
    event.preventDefault();
    const form = els.addMeasurementForm;
    if (!form.checkValidity()) {
      const firstInvalid = form.querySelector(':invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const puppyId = els.mPuppy.value;
    const pup = state.project.puppies.find((p) => p.id === puppyId);
    if (!pup) return;

    const week = Number(els.mWeek.value);
    const height = Number(els.mHeight.value);
    const note = els.mNote.value.trim();

    pushUndoSnapshot();
    pup.measurements.push({
      id: Storage.makeId('m'),
      week,
      height,
      note,
    });
    pup.measurements.sort((a, b) => a.week - b.week);
    state.selectedPuppyId = pup.id;
    markDirty(true);

    // Clear entry fields and refocus Age for rapid data entry
    els.mWeek.value = '';
    els.mHeight.value = '';
    els.mNote.value = '';
    formA11y.refreshAllFields(form);
    els.mWeek.focus();

    renderAll();
    toast.show(`Added ${height} cm at week ${week} for ${pup.name}.`, { variant: 'success' });
  }

  function openEditMeasurementDialog(puppyId, measurementId) {
    const pup = state.project.puppies.find((p) => p.id === puppyId);
    const meas = pup?.measurements.find((m) => m.id === measurementId);
    if (!pup || !meas) return;

    state.editingMeasurement = { puppyId, measurementId };
    els.editMWeek.value = String(meas.week);
    els.editMHeight.value = String(meas.height);
    els.editMNote.value = meas.note || '';
    formA11y.refreshAllFields(els.measurementDialogForm);
    els.measurementDialog.returnValue = '';
    els.measurementDialog.showModal();
  }

  function handleEditMeasurementSubmit(event) {
    event.preventDefault();
    const form = els.measurementDialogForm;
    if (!form.checkValidity()) {
      const firstInvalid = form.querySelector(':invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const ref = state.editingMeasurement;
    if (!ref) return;
    const pup = state.project.puppies.find((p) => p.id === ref.puppyId);
    const meas = pup?.measurements.find((m) => m.id === ref.measurementId);
    if (!pup || !meas) return;

    pushUndoSnapshot();
    meas.week = Number(els.editMWeek.value);
    meas.height = Number(els.editMHeight.value);
    meas.note = els.editMNote.value.trim();
    pup.measurements.sort((a, b) => a.week - b.week);
    markDirty(true);

    els.measurementDialog.close('saved');
    renderAll();
    toast.show(`Updated measurement for ${pup.name}.`, { variant: 'success' });
  }

  function deleteMeasurement(puppyId, measurementId) {
    const pup = state.project.puppies.find((p) => p.id === puppyId);
    if (!pup) return;
    const idx = pup.measurements.findIndex((m) => m.id === measurementId);
    if (idx === -1) return;
    const removed = pup.measurements[idx];

    pushUndoSnapshot();
    pup.measurements.splice(idx, 1);
    markDirty(true);
    renderAll();
    toast.show(`Removed week ${removed.week} (${removed.height} cm) from ${pup.name}.`, { variant: 'info' });
  }

  function buildColorSwatches(selectedColor) {
    els.puppyColorSwatches.textContent = '';
    for (const color of Storage.COLOR_PALETTE) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch-btn';
      btn.style.backgroundColor = color;
      btn.setAttribute('aria-label', `Select color ${color}`);
      btn.setAttribute('aria-pressed', String(color.toLowerCase() === selectedColor.toLowerCase()));
      btn.addEventListener('click', () => {
        els.puppyColorInput.value = color;
        for (const child of els.puppyColorSwatches.children) {
          child.setAttribute('aria-pressed', String(child === btn));
        }
      });
      els.puppyColorSwatches.append(btn);
    }
  }

  function openPuppyDialog(puppyToEdit = null) {
    state.editingPuppyId = puppyToEdit ? puppyToEdit.id : null;
    els.puppyDialogTitle.textContent = puppyToEdit ? `Edit ${puppyToEdit.name}` : 'Add Puppy';
    els.puppyNameInput.value = puppyToEdit ? puppyToEdit.name : '';
    const defaultColor = puppyToEdit
      ? puppyToEdit.color
      : Storage.COLOR_PALETTE[state.project.puppies.length % Storage.COLOR_PALETTE.length];
    els.puppyColorInput.value = defaultColor;
    buildColorSwatches(defaultColor);
    formA11y.refreshAllFields(els.puppyDialogForm);
    els.puppyDialog.returnValue = '';
    els.puppyDialog.showModal();
  }

  function handlePuppyDialogSubmit(event) {
    event.preventDefault();
    const form = els.puppyDialogForm;
    if (!form.checkValidity()) {
      const firstInvalid = form.querySelector(':invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const name = els.puppyNameInput.value.trim();
    const color = els.puppyColorInput.value || Storage.COLOR_PALETTE[0];

    pushUndoSnapshot();
    if (state.editingPuppyId) {
      const pup = state.project.puppies.find((p) => p.id === state.editingPuppyId);
      if (pup) {
        pup.name = name;
        pup.color = color;
      }
      toast.show(`Updated puppy "${name}".`, { variant: 'success' });
    } else {
      const newPup = {
        id: Storage.makeId('pup'),
        name,
        color,
        visible: true,
        measurements: [],
      };
      state.project.puppies.push(newPup);
      state.selectedPuppyId = newPup.id;
      toast.show(`Added puppy "${name}".`, { variant: 'success' });
    }

    markDirty(true);
    els.puppyDialog.close('saved');
    renderAll();
  }

  async function deletePuppy(puppyId) {
    const pup = state.project.puppies.find((p) => p.id === puppyId);
    if (!pup) return;

    const ok = await confirmAction({
      title: `Delete ${pup.name}?`,
      message: `This will remove "${pup.name}" and its ${pup.measurements.length} measurement(s). You can undo this immediately with Undo.`,
      confirmLabel: 'Delete Puppy',
      danger: true,
    });
    if (!ok) return;

    pushUndoSnapshot();
    state.project.puppies = state.project.puppies.filter((p) => p.id !== puppyId);
    if (state.selectedPuppyId === puppyId) {
      state.selectedPuppyId = state.project.puppies[0]?.id || null;
    }
    markDirty(true);
    renderAll();
    toast.show(`Deleted "${pup.name}".`, { variant: 'info' });
  }

  // --- Reference Range Dialog ---

  function renderRangeRows(rows) {
    els.rangeRowsContainer.textContent = '';

    const headers = ['Week', 'Min (cm)', 'Max (cm)', ''];
    for (const h of headers) {
      const span = document.createElement('span');
      span.className = 'range-grid-head';
      span.textContent = h;
      els.rangeRowsContainer.append(span);
    }

    const appendRow = (row) => {
      const wIn = document.createElement('input');
      wIn.type = 'number';
      wIn.min = '0';
      wIn.max = '104';
      wIn.step = '0.5';
      wIn.required = true;
      wIn.value = String(row.week);
      wIn.setAttribute('aria-label', 'Age in weeks');

      const minIn = document.createElement('input');
      minIn.type = 'number';
      minIn.min = '1';
      minIn.max = '150';
      minIn.step = '0.5';
      minIn.required = true;
      minIn.value = String(row.lower);
      minIn.setAttribute('aria-label', 'Minimum height in cm');

      const maxIn = document.createElement('input');
      maxIn.type = 'number';
      maxIn.min = '1';
      maxIn.max = '150';
      maxIn.step = '0.5';
      maxIn.required = true;
      maxIn.value = String(row.upper);
      maxIn.setAttribute('aria-label', 'Maximum height in cm');

      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'btn btn-sm btn-subtle';
      rmBtn.textContent = 'Remove';
      rmBtn.addEventListener('click', () => {
        wIn.remove();
        minIn.remove();
        maxIn.remove();
        rmBtn.remove();
      });

      els.rangeRowsContainer.append(wIn, minIn, maxIn, rmBtn);
    };

    for (const row of rows) {
      appendRow(row);
    }

    els.rangeRowsContainer._appendRow = appendRow;
  }

  function openReferenceDialog() {
    const tr = state.project.typicalRange;
    els.rangeLabelInput.value = tr.label || 'Typical Height Range';
    const rows = tr.ageWeeks.map((w, i) => ({
      week: w,
      lower: tr.lowerLimit[i],
      upper: tr.upperLimit[i],
    }));
    renderRangeRows(rows);
    formA11y.refreshAllFields(els.referenceDialogForm);
    els.referenceDialog.returnValue = '';
    els.referenceDialog.showModal();
  }

  function handleReferenceSubmit(event) {
    event.preventDefault();
    if (!els.referenceDialogForm.checkValidity()) {
      const firstInvalid = els.referenceDialogForm.querySelector(':invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const inputs = Array.from(els.rangeRowsContainer.querySelectorAll('input'));
    const rows = [];
    for (let i = 0; i < inputs.length; i += 3) {
      const week = Number(inputs[i].value);
      const lower = Number(inputs[i + 1].value);
      const upper = Number(inputs[i + 2].value);
      if (upper < lower) {
        toast.show(`Week ${week}: Max height must be >= Min height.`, { variant: 'error' });
        inputs[i + 2].focus();
        return;
      }
      rows.push({ week, lower, upper });
    }

    if (rows.length < 2) {
      toast.show('Provide at least 2 age points for the typical height band.', { variant: 'error' });
      return;
    }

    rows.sort((a, b) => a.week - b.week);
    pushUndoSnapshot();
    state.project.typicalRange = {
      label: els.rangeLabelInput.value.trim() || 'Typical Height Range',
      ageWeeks: rows.map((r) => r.week),
      lowerLimit: rows.map((r) => r.lower),
      upperLimit: rows.map((r) => r.upper),
    };
    markDirty(true);
    els.referenceDialog.close('saved');
    renderAll();
    toast.show('Updated typical height range.', { variant: 'success' });
  }

  // --- Save / Open / New / Export ---

  function downloadTextFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveProject({ saveAs = false } = {}) {
    const content = Storage.serializeProject(state.project);
    const suggestedName = state.fileName || Storage.slugifyFilename(state.project.name);

    const canUseFS =
      typeof window.showSaveFilePicker === 'function' &&
      (window.isSecureContext || location.protocol === 'http:' || location.protocol === 'https:');

    if (canUseFS) {
      try {
        let handle = saveAs ? null : state.fileHandle;
        if (!handle) {
          handle = await window.showSaveFilePicker({
            suggestedName,
            types: [
              {
                description: 'Puppy Growth Project (.puppyproj.json)',
                accept: { 'application/json': ['.puppyproj.json', '.json'] },
              },
            ],
          });
        }
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        state.fileHandle = handle;
        state.fileName = handle.name;
        markDirty(false);
        toast.show(`Saved project to ${handle.name}.`, { variant: 'success' });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        // Fall through to Blob download if picker fails (e.g., restricted context)
      }
    }

    downloadTextFile(suggestedName, content, 'application/json');
    state.fileName = suggestedName;
    markDirty(false);
    toast.show(`Downloaded project file "${suggestedName}".`, { variant: 'success' });
  }

  async function loadProjectFromText(text, fileName = null, fileHandle = null) {
    let parsed;
    try {
      parsed = Storage.parseProject(text);
    } catch (err) {
      toast.show(err.message || 'Could not open project file.', { variant: 'error' });
      return;
    }

    state.project = parsed;
    state.selectedPuppyId = parsed.puppies[0]?.id || null;
    state.fileHandle = fileHandle;
    state.fileName = fileName;
    state.undoStack = [];
    markDirty(false);
    renderAll();
    toast.show(`Opened "${parsed.name}" (${parsed.puppies.length} puppies).`, { variant: 'success' });
  }

  async function confirmDiscardIfDirty(actionDescription) {
    if (!state.isDirty) return true;
    return confirmAction({
      title: 'Unsaved changes',
      message: `You have unsaved changes. Continue to ${actionDescription} and discard unsaved edits?`,
      confirmLabel: 'Continue',
      danger: true,
    });
  }

  async function openProjectFlow() {
    if (!(await confirmDiscardIfDirty('open another project'))) return;

    const canUseFS =
      typeof window.showOpenFilePicker === 'function' &&
      (window.isSecureContext || location.protocol === 'http:' || location.protocol === 'https:');

    if (canUseFS) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: 'Puppy Growth Project',
              accept: { 'application/json': ['.puppyproj.json', '.json'] },
            },
          ],
        });
        const file = await handle.getFile();
        const text = await file.text();
        await loadProjectFromText(text, file.name, handle);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    els.fileOpenInput.value = '';
    els.fileOpenInput.click();
  }

  async function newProjectFlow() {
    if (!(await confirmDiscardIfDirty('create a blank project'))) return;
    state.project = Storage.createEmptyProject('Untitled Puppy Project');
    state.selectedPuppyId = null;
    state.fileHandle = null;
    state.fileName = null;
    state.undoStack = [];
    markDirty(false);
    renderAll();
    toast.show('Started a new blank project.', { variant: 'info' });
  }

  async function resetStarterFlow() {
    const ok = await confirmAction({
      title: 'Reset to starter data?',
      message: 'Restore the original Aliss & Lilly dataset from multi_puppy_chart.py? You can undo this with Undo.',
      confirmLabel: 'Reset Data',
      danger: true,
    });
    if (!ok) return;

    pushUndoSnapshot();
    state.project = Storage.createStarterProject();
    state.selectedPuppyId = state.project.puppies[0]?.id || null;
    state.fileHandle = null;
    state.fileName = null;
    markDirty(true);
    renderAll();
    toast.show('Restored starter data (Aliss & Lilly).', { variant: 'info' });
  }

  // --- Event Wiring ---

  function wireEvents() {
    // Generic dialog close buttons and returnValue cleanup
    document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dlg = document.getElementById(btn.dataset.closeDialog);
        if (dlg && dlg.open) dlg.close('');
      });
    });

    for (const dlg of document.querySelectorAll('dialog')) {
      dlg.addEventListener('close', () => {
        if (dlg === els.confirmDialog && state.confirmResolver) {
          const accepted = dlg.returnValue === 'confirm';
          const resolve = state.confirmResolver;
          state.confirmResolver = null;
          resolve(accepted);
        }
        dlg.returnValue = '';
      });
    }

    els.projectNameInput.addEventListener('change', () => {
      const trimmed = els.projectNameInput.value.trim() || 'Puppy Growth Project';
      if (trimmed === state.project.name) {
        els.projectNameInput.value = trimmed;
        return;
      }
      pushUndoSnapshot();
      state.project.name = trimmed;
      markDirty(true);
      renderChart();
    });

    els.btnUndo.addEventListener('click', performUndo);
    els.btnNew.addEventListener('click', newProjectFlow);
    els.btnOpen.addEventListener('click', openProjectFlow);
    els.btnSave.addEventListener('click', () => saveProject({ saveAs: false }));
    els.btnSaveAs.addEventListener('click', () => saveProject({ saveAs: true }));
    els.btnRange.addEventListener('click', openReferenceDialog);

    els.projectionModelSelect.addEventListener('change', () => {
      state.project.settings.projectionModel = els.projectionModelSelect.value;
      markDirty(true);
      renderAll();
    });

    els.toggleTypicalRange.addEventListener('change', () => {
      state.project.settings.showTypicalRange = els.toggleTypicalRange.checked;
      markDirty(true);
      renderChart();
    });

    els.toggleProjections.addEventListener('change', () => {
      state.project.settings.showProjections = els.toggleProjections.checked;
      markDirty(true);
      renderChart();
    });

    els.toggleConfidenceBand.addEventListener('change', () => {
      state.project.settings.showConfidenceBand = els.toggleConfidenceBand.checked;
      markDirty(true);
      renderChart();
    });

    els.toggleVelocityChart.addEventListener('change', () => {
      state.project.settings.showVelocityChart = els.toggleVelocityChart.checked;
      markDirty(true);
      renderVelocityChart();
    });

    els.btnExportCsv.addEventListener('click', () => {
      const csv = Storage.exportCsv(state.project);
      const name = Storage.slugifyFilename(state.project.name).replace(/\.puppyproj\.json$/, '.csv');
      downloadTextFile(name, csv, 'text/csv;charset=utf-8');
      toast.show(`Exported CSV "${name}".`, { variant: 'success' });
    });

    els.btnResetStarter.addEventListener('click', resetStarterFlow);
    els.btnAddPuppy.addEventListener('click', () => openPuppyDialog(null));
    els.btnEditPuppy.addEventListener('click', () => {
      const selected = getSelectedPuppy();
      if (selected) openPuppyDialog(selected);
    });

    els.mPuppy.addEventListener('change', () => {
      state.selectedPuppyId = els.mPuppy.value;
      renderAll();
    });

    els.addMeasurementForm.addEventListener('submit', handleAddMeasurementSubmit);
    els.puppyDialogForm.addEventListener('submit', handlePuppyDialogSubmit);
    els.measurementDialogForm.addEventListener('submit', handleEditMeasurementSubmit);
    els.referenceDialogForm.addEventListener('submit', handleReferenceSubmit);

    els.btnAddRangeRow.addEventListener('click', () => {
      if (typeof els.rangeRowsContainer._appendRow === 'function') {
        els.rangeRowsContainer._appendRow({ week: 40, lower: 30, upper: 36 });
      }
    });

    els.btnResetRangeDefault.addEventListener('click', () => {
      const def = Storage.cloneDefaultTypicalRange();
      els.rangeLabelInput.value = def.label;
      const rows = def.ageWeeks.map((w, i) => ({
        week: w,
        lower: def.lowerLimit[i],
        upper: def.upperLimit[i],
      }));
      renderRangeRows(rows);
    });

    els.fileOpenInput.addEventListener('change', async () => {
      const file = els.fileOpenInput.files?.[0];
      if (!file) return;
      const text = await file.text();
      await loadProjectFromText(text, file.name, null);
    });

    // Drag & Drop .json / .puppyproj.json open
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        dragDepth += 1;
        els.dropOverlay.hidden = false;
      }
    });
    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) els.dropOverlay.hidden = true;
    });
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
      }
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragDepth = 0;
      els.dropOverlay.hidden = true;
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!(await confirmDiscardIfDirty(`open "${file.name}"`))) return;
      const text = await file.text();
      await loadProjectFromText(text, file.name, null);
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProject({ saveAs: e.shiftKey });
      } else if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const tag = document.activeElement?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          performUndo();
        }
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    if (typeof ResizeObserver === 'function' && window.Plotly) {
      const ro = new ResizeObserver(() => {
        if (els.growthChart && els.growthChart.data) {
          Plotly.Plots.resize(els.growthChart);
        }
        if (els.velocityChart && els.velocityChart.data && !els.velocityPanel.hidden) {
          Plotly.Plots.resize(els.velocityChart);
        }
      });
      ro.observe(els.growthChart);
      ro.observe(els.velocityChart);
    }

    darkModeMql = window.matchMedia('(prefers-color-scheme: dark)');
    if (darkModeMql.addEventListener) {
      darkModeMql.addEventListener('change', () => {
        renderChart();
        renderVelocityChart();
      });
    }
  }

  function init() {
    cacheElements();
    UIHelpers.initDialogLightDismissFallback();
    formA11y = UIHelpers.initFormValidationA11y();
    toast = UIHelpers.createToastManager();

    const autosaved = Storage.loadAutosave();
    if (autosaved) {
      state.project = autosaved;
      state.isDirty = false;
    } else {
      state.project = Storage.createStarterProject();
      state.isDirty = false;
      Storage.saveAutosave(state.project);
    }

    state.selectedPuppyId = state.project.puppies[0]?.id || null;
    wireEvents();
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
