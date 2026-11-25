(function (globalScope) {
  'use strict';

  const GompertzLib =
    (typeof window !== 'undefined' && window.PuppyGompertz) ||
    (typeof require === 'function' ? require('./gompertz.js') : null);

  if (!GompertzLib) {
    throw new Error('PuppyGompertz must be loaded before PuppyProjections.');
  }

  const { gompertz, linspace, fitGompertz } = GompertzLib;

  const VALID_MODELS = ['gompertz', 'brody', 'logistic', 'richards', 'percentile', 'compare'];

  // Two-tailed t_{0.975, df} for df = 1..30
  const T_CRIT_95 = [
    NaN,
    12.7062, 4.3027, 3.1824, 2.7764, 2.5706,
    2.4469, 2.3646, 2.3060, 2.2622, 2.2281,
    2.2010, 2.1788, 2.1604, 2.1448, 2.1314,
    2.1199, 2.1098, 2.1009, 2.0930, 2.0860,
    2.0796, 2.0739, 2.0687, 2.0639, 2.0595,
    2.0555, 2.0518, 2.0484, 2.0452, 2.0423,
  ];

  function tCritical95(df) {
    if (!Number.isFinite(df) || df < 1) return NaN;
    const d = Math.floor(df);
    if (d <= 30) return T_CRIT_95[d];
    // Cornish-Fisher approximation for z = 1.959964
    const z = 1.959963984540054;
    const z3 = z * z * z;
    const z5 = z3 * z * z;
    return z + (z3 + z) / (4 * d) + (5 * z5 + 16 * z3 + 3 * z) / (96 * d * d);
  }

  function solveLinear(matrix, rhs) {
    const p = rhs.length;
    const a = new Array(p);
    for (let i = 0; i < p; i++) {
      a[i] = [...matrix[i], rhs[i]];
    }

    for (let col = 0; col < p; col++) {
      let pivotRow = col;
      let maxVal = Math.abs(a[col][col]);
      for (let row = col + 1; row < p; row++) {
        const val = Math.abs(a[row][col]);
        if (val > maxVal) {
          maxVal = val;
          pivotRow = row;
        }
      }
      if (!Number.isFinite(maxVal) || maxVal < 1e-18) return null;
      if (pivotRow !== col) {
        const tmp = a[col];
        a[col] = a[pivotRow];
        a[pivotRow] = tmp;
      }
      const pivot = a[col][col];
      for (let row = col + 1; row < p; row++) {
        const factor = a[row][col] / pivot;
        if (!Number.isFinite(factor)) return null;
        for (let k = col; k <= p; k++) {
          a[row][k] -= factor * a[col][k];
        }
      }
    }

    const sol = new Array(p).fill(0);
    for (let row = p - 1; row >= 0; row--) {
      let sum = a[row][p];
      for (let col = row + 1; col < p; col++) {
        sum -= a[row][col] * sol[col];
      }
      const val = sum / a[row][row];
      if (!Number.isFinite(val)) return null;
      sol[row] = val;
    }
    return sol;
  }

  function invertMatrix(matrix) {
    const p = matrix.length;
    const inv = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let col = 0; col < p; col++) {
      const e = new Array(p).fill(0);
      e[col] = 1;
      const x = solveLinear(matrix, e);
      if (!x) return null;
      for (let row = 0; row < p; row++) {
        inv[row][col] = x[row];
      }
    }
    return inv;
  }

  function computeAICc(n, sse, paramCount) {
    if (n <= 0 || !Number.isFinite(sse)) return null;
    const k = paramCount + 1;
    const base = n * Math.log(Math.max(sse, 1e-12) / n) + 2 * k;
    if (n > k + 1) {
      return base + (2 * k * (k + 1)) / (n - k - 1);
    }
    return base;
  }

  function computeFitStats(ys, sse) {
    const n = ys.length;
    const meanY = ys.reduce((acc, v) => acc + v, 0) / n;
    let tss = 0;
    for (let i = 0; i < n; i++) {
      const d = ys[i] - meanY;
      tss += d * d;
    }
    const rmse = Math.sqrt(sse / n);
    const rSquared = tss > 1e-12 ? Math.max(0, 1 - sse / tss) : 1;
    return { rmse, rSquared };
  }

  function computeConfidenceBand(xs, ys, sse, evalGrad, curveX, curveY, paramCount) {
    const n = xs.length;
    if (n < paramCount + 2) return null;

    const jtj = Array.from({ length: paramCount }, () => new Array(paramCount).fill(0));
    for (let i = 0; i < n; i++) {
      const g = evalGrad(xs[i]);
      if (!g || g.some((v) => !Number.isFinite(v))) return null;
      for (let r = 0; r < paramCount; r++) {
        for (let c = 0; c < paramCount; c++) {
          jtj[r][c] += g[r] * g[c];
        }
      }
    }

    let inv = invertMatrix(jtj);
    if (!inv) {
      const stabilized = jtj.map((row, r) =>
        row.map((val, c) => (r === c ? val + 1e-9 * Math.max(Math.abs(val), 1) : val))
      );
      inv = invertMatrix(stabilized);
      if (!inv) return null;
    }

    const df = n - paramCount;
    const s2 = Math.max(sse, 0) / df;
    const tCrit = tCritical95(df);
    if (!Number.isFinite(tCrit)) return null;

    const upper = new Array(curveX.length);
    const lower = new Array(curveX.length);
    let maxHalf = 0;

    for (let i = 0; i < curveX.length; i++) {
      const g = evalGrad(curveX[i]);
      if (!g || g.some((v) => !Number.isFinite(v))) return null;

      let quad = 0;
      for (let r = 0; r < paramCount; r++) {
        let rowSum = 0;
        for (let c = 0; c < paramCount; c++) {
          rowSum += inv[r][c] * g[c];
        }
        quad += g[r] * rowSum;
      }

      if (!Number.isFinite(quad)) return null;
      const se = Math.sqrt(Math.max(0, quad) * s2);
      const half = tCrit * se;
      if (!Number.isFinite(half)) return null;
      if (half > maxHalf) maxHalf = half;

      upper[i] = curveY[i] + half;
      lower[i] = Math.max(0, curveY[i] - half);
    }

    if (maxHalf > 40) return null;
    return { upper, lower };
  }

  function runGenericLM(xs, ys, initialParams, evalModel, isValidParams, maxIters = 500) {
    const p = initialParams.length;
    const n = xs.length;
    let params = [...initialParams];

    const evalState = (cand) => {
      if (!isValidParams(cand)) return null;
      let sse = 0;
      const residuals = new Array(n);
      const jac = new Array(n);
      for (let i = 0; i < n; i++) {
        const res = evalModel(xs[i], cand);
        if (!res || !Number.isFinite(res.y) || res.grad.some((v) => !Number.isFinite(v))) {
          return null;
        }
        const r = ys[i] - res.y;
        residuals[i] = r;
        sse += r * r;
        jac[i] = res.grad;
      }
      if (!Number.isFinite(sse)) return null;
      return { sse, residuals, jac };
    };

    let state = evalState(params);
    if (!state) return null;

    let lambda = 1e-3;
    for (let iter = 0; iter < maxIters; iter++) {
      const jtj = Array.from({ length: p }, () => new Array(p).fill(0));
      const jtr = new Array(p).fill(0);

      for (let i = 0; i < n; i++) {
        const row = state.jac[i];
        const r = state.residuals[i];
        for (let rIdx = 0; rIdx < p; rIdx++) {
          jtr[rIdx] += row[rIdx] * r;
          for (let cIdx = 0; cIdx < p; cIdx++) {
            jtj[rIdx][cIdx] += row[rIdx] * row[cIdx];
          }
        }
      }

      const damped = jtj.map((row, rIdx) =>
        row.map((val, cIdx) => (rIdx === cIdx ? val + lambda * Math.max(val, 1e-8) : val))
      );

      const step = solveLinear(damped, jtr);
      if (!step) {
        lambda *= 10;
        if (lambda > 1e12) break;
        continue;
      }

      const stepNormSq = step.reduce((acc, v) => acc + v * v, 0);
      const candParams = params.map((v, idx) => v + step[idx]);
      const candState = evalState(candParams);

      if (candState && candState.sse <= state.sse) {
        const relImprove = Math.abs(state.sse - candState.sse) / Math.max(state.sse, 1e-12);
        params = candParams;
        state = candState;
        lambda = Math.max(lambda * 0.3, 1e-12);
        if (stepNormSq < 1e-16 || relImprove < 1e-12) {
          break;
        }
      } else {
        lambda *= 10;
        if (lambda > 1e12) break;
      }
    }

    return { params, sse: state.sse };
  }

  function cleanPoints(measurements) {
    if (!Array.isArray(measurements)) return [];
    return measurements
      .filter(
        (pt) =>
          pt &&
          Number.isFinite(Number(pt.week)) &&
          Number.isFinite(Number(pt.height)) &&
          Number(pt.week) >= 0 &&
          Number(pt.height) > 0
      )
      .map((pt) => ({ week: Number(pt.week), height: Number(pt.height) }))
      .sort((p1, p2) => p1.week - p2.week);
  }

  function hasSpread(clean) {
    if (clean.length < 2) return false;
    const ys = clean.map((p) => p.height);
    const yMax = Math.max(...ys);
    const yMin = Math.min(...ys);
    return yMax - yMin >= 1e-9 && clean[clean.length - 1].week - clean[0].week >= 1e-9;
  }

  // --- Model 1: Gompertz (Default) ---
  function fitGompertzModel(clean) {
    const base = fitGompertz(clean);
    if (!base) return null;

    const [a, b, c] = base.params;
    const xs = clean.map((p) => p.week);
    const ys = clean.map((p) => p.height);

    let sse = 0;
    for (let i = 0; i < xs.length; i++) {
      const diff = ys[i] - gompertz(xs[i], a, b, c);
      sse += diff * diff;
    }

    const evalGrad = (x) => {
      const u = Math.exp(-c * x);
      const v = Math.exp(-b * u);
      return [v, -a * v * u, a * v * b * u * x];
    };

    const velocityAt = (x) => {
      const u = Math.exp(-c * x);
      const v = Math.exp(-b * u);
      return a * v * b * c * u;
    };

    const weekQ = (q) => {
      const w = -Math.log(-Math.log(q) / b) / c;
      return Number.isFinite(w) && w >= 0 && w <= 260 ? w : null;
    };

    return {
      id: 'gompertz',
      label: 'Gompertz',
      shortLabel: 'Gompertz',
      params: base.params,
      a,
      sse,
      rmse: base.rmse,
      rSquared: base.rSquared,
      aicc: computeAICc(xs.length, sse, 3),
      projectedWeek52: base.projectedWeek52,
      curve: base.curve,
      ci95: computeConfidenceBand(xs, ys, sse, evalGrad, base.curve.x, base.curve.y, 3),
      velocityCurve: {
        x: base.curve.x,
        y: base.curve.x.map(velocityAt),
      },
      velocityAt,
      week95: weekQ(0.95),
      week99: weekQ(0.99),
    };
  }

  // --- Model 2: Brody (Monomolecular) ---
  function fitBrodyModel(clean) {
    if (clean.length < 4 || !hasSpread(clean)) return null;
    const xs = clean.map((p) => p.week);
    const ys = clean.map((p) => p.height);
    const yLast = ys[ys.length - 1];
    const yMax = Math.max(...ys);

    const evalModel = (x, [a, b, c]) => {
      const u = Math.exp(-c * x);
      const y = a * (1 - b * u);
      return { y, grad: [1 - b * u, -a * u, a * b * x * u] };
    };

    const isValid = ([a, b, c]) =>
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Number.isFinite(c) &&
      a > 0 &&
      a <= 300 &&
      b > 0 &&
      b <= 5 &&
      c > 0 &&
      c <= 5;

    const guesses = [
      [yLast + 4, 0.85, 0.08],
      [yMax * 1.15, 0.9, 0.06],
      [yMax * 1.05, 0.7, 0.12],
    ];

    let best = null;
    for (const g of guesses) {
      const res = runGenericLM(xs, ys, g, evalModel, isValid);
      if (res && (!best || res.sse < best.sse)) best = res;
    }
    if (!best) return null;

    const [a, b, c] = best.params;
    const curveX = linspace(4, 52, 100);
    const curveY = curveX.map((x) => a * (1 - b * Math.exp(-c * x)));
    if (curveY.some((y) => !Number.isFinite(y) || y < 0)) return null;

    const { rmse, rSquared } = computeFitStats(ys, best.sse);
    const evalGrad = (x) => evalModel(x, [a, b, c]).grad;
    const velocityAt = (x) => a * b * c * Math.exp(-c * x);
    const weekQ = (q) => {
      const ratio = (1 - q) / b;
      if (ratio <= 0) return null;
      const w = -Math.log(ratio) / c;
      return Number.isFinite(w) && w >= 0 && w <= 260 ? w : null;
    };

    return {
      id: 'brody',
      label: 'Brody (Monomolecular)',
      shortLabel: 'Brody',
      params: best.params,
      a,
      sse: best.sse,
      rmse,
      rSquared,
      aicc: computeAICc(xs.length, best.sse, 3),
      projectedWeek52: a * (1 - b * Math.exp(-c * 52)),
      curve: { x: curveX, y: curveY },
      ci95: computeConfidenceBand(xs, ys, best.sse, evalGrad, curveX, curveY, 3),
      velocityCurve: { x: curveX, y: curveX.map(velocityAt) },
      velocityAt,
      week95: weekQ(0.95),
      week99: weekQ(0.99),
    };
  }

  // --- Model 3: Logistic ---
  function fitLogisticModel(clean) {
    if (clean.length < 4 || !hasSpread(clean)) return null;
    const xs = clean.map((p) => p.week);
    const ys = clean.map((p) => p.height);
    const yLast = ys[ys.length - 1];
    const yMax = Math.max(...ys);

    const evalModel = (x, [a, b, c]) => {
      const u = Math.exp(-c * x);
      const d = 1 + b * u;
      const y = a / d;
      return {
        y,
        grad: [1 / d, (-a * u) / (d * d), (a * b * x * u) / (d * d)],
      };
    };

    const isValid = ([a, b, c]) =>
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Number.isFinite(c) &&
      a > 0 &&
      a <= 300 &&
      b > 0 &&
      b <= 1000 &&
      c > 0 &&
      c <= 5;

    const guesses = [
      [yLast + 3, 2.5, 0.12],
      [yMax * 1.1, 4, 0.15],
      [yMax * 1.05, 1.5, 0.09],
    ];

    let best = null;
    for (const g of guesses) {
      const res = runGenericLM(xs, ys, g, evalModel, isValid);
      if (res && (!best || res.sse < best.sse)) best = res;
    }
    if (!best) return null;

    const [a, b, c] = best.params;
    const curveX = linspace(4, 52, 100);
    const curveY = curveX.map((x) => a / (1 + b * Math.exp(-c * x)));
    if (curveY.some((y) => !Number.isFinite(y) || y < 0)) return null;

    const { rmse, rSquared } = computeFitStats(ys, best.sse);
    const evalGrad = (x) => evalModel(x, [a, b, c]).grad;
    const velocityAt = (x) => {
      const u = Math.exp(-c * x);
      const d = 1 + b * u;
      return (a * b * c * u) / (d * d);
    };
    const weekQ = (q) => {
      const w = -Math.log((1 - q) / (q * b)) / c;
      return Number.isFinite(w) && w >= 0 && w <= 260 ? w : null;
    };

    return {
      id: 'logistic',
      label: 'Logistic',
      shortLabel: 'Logistic',
      params: best.params,
      a,
      sse: best.sse,
      rmse,
      rSquared,
      aicc: computeAICc(xs.length, best.sse, 3),
      projectedWeek52: a / (1 + b * Math.exp(-c * 52)),
      curve: { x: curveX, y: curveY },
      ci95: computeConfidenceBand(xs, ys, best.sse, evalGrad, curveX, curveY, 3),
      velocityCurve: { x: curveX, y: curveX.map(velocityAt) },
      velocityAt,
      week95: weekQ(0.95),
      week99: weekQ(0.99),
    };
  }

  // --- Model 4: Richards (4-parameter generalized) ---
  function fitRichardsModel(clean, seeds) {
    if (clean.length < 6 || !hasSpread(clean)) return null;
    const xs = clean.map((p) => p.week);
    const ys = clean.map((p) => p.height);
    const minCheckX = Math.min(4, xs[0]);

    const evalModel = (x, [a, b, c, m]) => {
      const u = Math.exp(-c * x);
      const bu = b * u;
      if (Math.abs(m) < 1e-4) {
        // Smooth limit -> Gompertz: a * exp(-b*u + (m/2)*(b*u)^2)
        const logV = -bu + 0.5 * m * bu * bu;
        const v = Math.exp(logV);
        const y = a * v;
        return {
          y,
          grad: [
            v,
            y * (-u + m * b * u * u),
            y * (bu - m * bu * bu) * x,
            y * 0.5 * bu * bu,
          ],
        };
      }
      const w = 1 + m * bu;
      if (w <= 1e-4) return null;
      const v = Math.pow(w, -1 / m);
      const y = a * v;
      const dvDw = (-1 / m) * Math.pow(w, -1 / m - 1);
      const dyDb = a * dvDw * m * u; // = -a * v * u / w
      const dyDc = a * dvDw * m * b * (-x * u); // = a * v * b * u * x / w
      const dyDm = y * (Math.log(w) / (m * m) - bu / (m * w));
      return { y, grad: [v, dyDb, dyDc, dyDm] };
    };

    const isValid = ([a, b, c, m]) => {
      if (
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        !Number.isFinite(c) ||
        !Number.isFinite(m)
      ) {
        return false;
      }
      if (a <= 0 || a > 300 || b <= 0 || b > 1000 || c <= 0 || c > 5 || m < -0.99 || m > 4) {
        return false;
      }
      // Check domain positivity at both earliest measurement and week 4
      if (1 + m * b * Math.exp(-c * minCheckX) <= 1e-4) return false;
      if (1 + m * b * Math.exp(-c * 4) <= 1e-4) return false;
      return true;
    };

    const guesses = [];
    if (seeds.gompertz) {
      const [ga, gb, gc] = seeds.gompertz.params;
      guesses.push([ga, gb, gc, 0.05], [ga, gb, gc, -0.05]);
    }
    if (seeds.brody) {
      const [ba, bb, bc] = seeds.brody.params;
      guesses.push([ba, bb, bc, -0.95]);
    }
    if (seeds.logistic) {
      const [la, lb, lc] = seeds.logistic.params;
      guesses.push([la, lb, lc, 1.0]);
    }
    if (guesses.length === 0) {
      const yLast = ys[ys.length - 1];
      guesses.push([yLast + 4, 2, 0.1, 0.5]);
    }

    let best = null;
    for (const g of guesses) {
      const res = runGenericLM(xs, ys, g, evalModel, isValid);
      if (res && (!best || res.sse < best.sse)) best = res;
    }
    if (!best) return null;

    const [a, b, c, m] = best.params;
    const curveX = linspace(4, 52, 100);
    const curveY = new Array(curveX.length);
    for (let i = 0; i < curveX.length; i++) {
      const ev = evalModel(curveX[i], best.params);
      if (!ev || !Number.isFinite(ev.y) || ev.y < 0) return null;
      curveY[i] = ev.y;
    }

    const { rmse, rSquared } = computeFitStats(ys, best.sse);
    const evalGrad = (x) => {
      const ev = evalModel(x, best.params);
      return ev ? ev.grad : null;
    };
    const velocityAt = (x) => {
      const u = Math.exp(-c * x);
      const bu = b * u;
      if (Math.abs(m) < 1e-4) {
        const v = Math.exp(-bu + 0.5 * m * bu * bu);
        return a * v * (bu - m * bu * bu) * c;
      }
      const w = 1 + m * bu;
      if (w <= 1e-4) return 0;
      const v = Math.pow(w, -1 / m);
      return (a * v * bu * c) / w;
    };

    const weekQ = (q) => {
      let w;
      if (Math.abs(m) < 1e-4) {
        w = -Math.log(-Math.log(q) / b) / c;
      } else {
        const inner = (Math.pow(q, -m) - 1) / (m * b);
        if (inner <= 0) return null;
        w = -Math.log(inner) / c;
      }
      return Number.isFinite(w) && w >= 0 && w <= 260 ? w : null;
    };

    const week52Eval = evalModel(52, best.params);
    if (!week52Eval) return null;

    return {
      id: 'richards',
      label: 'Richards (4-param)',
      shortLabel: 'Richards',
      params: best.params,
      a,
      sse: best.sse,
      rmse,
      rSquared,
      aicc: computeAICc(xs.length, best.sse, 4),
      projectedWeek52: week52Eval.y,
      curve: { x: curveX, y: curveY },
      ci95: computeConfidenceBand(xs, ys, best.sse, evalGrad, curveX, curveY, 4),
      velocityCurve: { x: curveX, y: curveX.map(velocityAt) },
      velocityAt,
      week95: weekQ(0.95),
      week99: weekQ(0.99),
    };
  }

  // --- Range Interpolation & Breed Standard ---
  function interpolateRange(typicalRange, week) {
    if (
      !typicalRange ||
      !Array.isArray(typicalRange.ageWeeks) ||
      typicalRange.ageWeeks.length < 2
    ) {
      return { lower: 30, upper: 36 };
    }
    const ws = typicalRange.ageWeeks;
    const ls = typicalRange.lowerLimit;
    const us = typicalRange.upperLimit;
    const n = ws.length;

    if (week <= ws[0]) return { lower: ls[0], upper: us[0] };
    if (week >= ws[n - 1]) return { lower: ls[n - 1], upper: us[n - 1] };

    for (let i = 0; i < n - 1; i++) {
      if (week >= ws[i] && week <= ws[i + 1]) {
        const span = ws[i + 1] - ws[i];
        const t = span > 0 ? (week - ws[i]) / span : 0;
        return {
          lower: ls[i] + t * (ls[i + 1] - ls[i]),
          upper: us[i] + t * (us[i + 1] - us[i]),
        };
      }
    }
    return { lower: ls[n - 1], upper: us[n - 1] };
  }

  function evaluateBreedStandard(projectedHeight, typicalRange) {
    if (!Number.isFinite(projectedHeight)) return null;
    const { lower, upper } = interpolateRange(typicalRange, 52);
    let status = 'within';
    let label = 'In typical range';
    if (projectedHeight < lower) {
      status = 'below';
      label = 'Below typical';
    } else if (projectedHeight > upper) {
      status = 'above';
      label = 'Above typical';
    }
    return { status, lower52: lower, upper52: upper, label };
  }

  // --- Model 5: Breed-Band Percentile Track (Works for 1+ points) ---
  function fitPercentileTrackModel(clean, typicalRange) {
    if (clean.length < 1 || !typicalRange || !Array.isArray(typicalRange.ageWeeks) || typicalRange.ageWeeks.length < 2) {
      return null;
    }
    const n = clean.length;
    const positions = new Array(n);
    const weights = new Array(n);
    let weightSum = 0;

    for (let i = 0; i < n; i++) {
      const { lower, upper } = interpolateRange(typicalRange, clean[i].week);
      const width = Math.max(upper - lower, 0.5);
      positions[i] = (clean[i].height - lower) / width;
      const w = Math.pow(0.7, n - 1 - i);
      weights[i] = w;
      weightSum += w;
    }

    let pHat = 0;
    for (let i = 0; i < n; i++) {
      pHat += (weights[i] / weightSum) * positions[i];
    }

    const curveX = linspace(4, 52, 100);
    const curveY = curveX.map((w) => {
      const { lower, upper } = interpolateRange(typicalRange, w);
      return Math.max(1, lower + pHat * (upper - lower));
    });

    // Fit stats against historical points
    let sse = 0;
    for (let i = 0; i < n; i++) {
      const { lower, upper } = interpolateRange(typicalRange, clean[i].week);
      const pred = Math.max(1, lower + pHat * (upper - lower));
      const d = clean[i].height - pred;
      sse += d * d;
    }
    const { rmse, rSquared } = computeFitStats(
      clean.map((p) => p.height),
      sse
    );

    let ci95 = null;
    if (n >= 2) {
      let varSum = 0;
      for (let i = 0; i < n; i++) {
        const diff = positions[i] - pHat;
        varSum += (weights[i] / weightSum) * diff * diff;
      }
      const sigmaP = Math.sqrt((n / (n - 1)) * varSum);
      const tCrit = tCritical95(n - 1);
      const upperArr = new Array(curveX.length);
      const lowerArr = new Array(curveX.length);
      let maxHalf = 0;
      let valid = true;

      for (let i = 0; i < curveX.length; i++) {
        const { lower, upper } = interpolateRange(typicalRange, curveX[i]);
        const half = tCrit * (sigmaP / Math.sqrt(n)) * Math.max(upper - lower, 0.5);
        if (!Number.isFinite(half)) {
          valid = false;
          break;
        }
        if (half > maxHalf) maxHalf = half;
        upperArr[i] = curveY[i] + half;
        lowerArr[i] = Math.max(0, curveY[i] - half);
      }

      if (valid && maxHalf <= 40) {
        ci95 = { upper: upperArr, lower: lowerArr };
      }
    }

    // Centered finite difference velocity along curve
    const velY = new Array(curveX.length);
    for (let i = 0; i < curveX.length; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(curveX.length - 1, i + 1);
      const dx = curveX[i1] - curveX[i0];
      velY[i] = dx > 0 ? Math.max(0, (curveY[i1] - curveY[i0]) / dx) : 0;
    }

    const velocityAt = (week) => {
      if (week <= curveX[0]) return velY[0];
      if (week >= curveX[curveX.length - 1]) return velY[velY.length - 1];
      for (let i = 0; i < curveX.length - 1; i++) {
        if (week >= curveX[i] && week <= curveX[i + 1]) {
          const t = (week - curveX[i]) / (curveX[i + 1] - curveX[i]);
          return velY[i] + t * (velY[i + 1] - velY[i]);
        }
      }
      return 0;
    };

    const r52 = interpolateRange(typicalRange, 52);
    const projectedWeek52 = Math.max(1, r52.lower + pHat * (r52.upper - r52.lower));

    return {
      id: 'percentile',
      label: 'Percentile Track',
      shortLabel: 'Percentile',
      params: [pHat],
      a: null,
      sse,
      rmse,
      rSquared,
      aicc: null,
      projectedWeek52,
      curve: { x: curveX, y: curveY },
      ci95,
      velocityCurve: { x: curveX, y: velY },
      velocityAt,
      week95: null,
      week99: null,
      percentilePos: pHat,
    };
  }

  function computeObservedVelocity(clean) {
    const x = [];
    const y = [];
    for (let i = 1; i < clean.length; i++) {
      const dw = clean[i].week - clean[i - 1].week;
      if (dw > 1e-6) {
        x.push((clean[i].week + clean[i - 1].week) / 2);
        y.push((clean[i].height - clean[i - 1].height) / dw);
      }
    }
    return { x, y };
  }

  function computeMilestones(measurements, fit, typicalRange) {
    const clean = cleanPoints(measurements);
    const latest = clean.length > 0 ? clean[clean.length - 1] : null;
    if (!latest || !fit) {
      return {
        latestWeek: latest ? latest.week : null,
        latestHeight: latest ? latest.height : null,
        percentAdult: null,
        currentVelocity: null,
        week95: null,
        week99: null,
        breedCheck: null,
      };
    }

    const denom = fit.a || fit.projectedWeek52;
    const percentAdult = denom > 0 ? Math.min(100, (latest.height / denom) * 100) : null;
    const currentVelocity =
      typeof fit.velocityAt === 'function' ? fit.velocityAt(latest.week) : null;

    return {
      latestWeek: latest.week,
      latestHeight: latest.height,
      percentAdult,
      currentVelocity,
      week95: fit.week95,
      week99: fit.week99,
      breedCheck: evaluateBreedStandard(fit.projectedWeek52, typicalRange),
    };
  }

  function analyzePuppy(measurements, typicalRange) {
    const clean = cleanPoints(measurements);
    const gomp = fitGompertzModel(clean);
    const brody = fitBrodyModel(clean);
    const logistic = fitLogisticModel(clean);
    const richards = fitRichardsModel(clean, { gompertz: gomp, brody, logistic });
    const percentile = fitPercentileTrackModel(clean, typicalRange);

    const models = {
      gompertz: gomp,
      brody,
      logistic,
      richards,
      percentile,
    };

    const parametricOrder = ['gompertz', 'brody', 'logistic', 'richards'];
    const convergedParametric = parametricOrder.map((id) => models[id]).filter(Boolean);

    let bestModelId = null;
    if (convergedParametric.length > 0) {
      let bestScore = Infinity;
      for (const m of convergedParametric) {
        const score = Number.isFinite(m.aicc) ? m.aicc : m.rmse;
        if (score < bestScore) {
          bestScore = score;
          bestModelId = m.id;
        }
      }
    }

    let consensus = null;
    if (convergedParametric.length >= 2) {
      const w52s = convergedParametric.map((m) => m.projectedWeek52);
      consensus = {
        minWeek52: Math.min(...w52s),
        maxWeek52: Math.max(...w52s),
        count: convergedParametric.length,
      };
    }

    return {
      cleanCount: clean.length,
      models,
      bestModelId,
      consensus,
      observedVelocity: computeObservedVelocity(clean),
    };
  }

  const api = {
    VALID_MODELS,
    tCritical95,
    computeAICc,
    interpolateRange,
    evaluateBreedStandard,
    computeMilestones,
    analyzePuppy,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.PuppyProjections = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
