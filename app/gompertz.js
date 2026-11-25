(function (globalScope) {
  'use strict';

  /**
   * Evaluate the Gompertz growth function: a * exp(-b * exp(-c * x)).
   * @param {number} x - Age in weeks.
   * @param {number} a - Upper asymptote (projected adult height).
   * @param {number} b - X-axis displacement parameter.
   * @param {number} c - Growth rate parameter.
   * @returns {number}
   */
  function gompertz(x, a, b, c) {
    return a * Math.exp(-b * Math.exp(-c * x));
  }

  /**
   * Generate evenly spaced values inclusive of start and end.
   * @param {number} start
   * @param {number} end
   * @param {number} count
   * @returns {number[]}
   */
  function linspace(start, end, count) {
    if (count <= 0) return [];
    if (count === 1) return [start];
    const step = (end - start) / (count - 1);
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      out[i] = i === count - 1 ? end : start + step * i;
    }
    return out;
  }

  /**
   * Solve a 3x3 linear system A * x = rhs via Gaussian elimination with partial pivoting.
   * @param {number[][]} matrix
   * @param {number[]} rhs
   * @returns {number[] | null}
   */
  function solve3x3(matrix, rhs) {
    const a = [
      [matrix[0][0], matrix[0][1], matrix[0][2], rhs[0]],
      [matrix[1][0], matrix[1][1], matrix[1][2], rhs[1]],
      [matrix[2][0], matrix[2][1], matrix[2][2], rhs[2]],
    ];

    for (let col = 0; col < 3; col++) {
      let pivotRow = col;
      let maxVal = Math.abs(a[col][col]);
      for (let row = col + 1; row < 3; row++) {
        const val = Math.abs(a[row][col]);
        if (val > maxVal) {
          maxVal = val;
          pivotRow = row;
        }
      }
      if (!Number.isFinite(maxVal) || maxVal < 1e-18) {
        return null;
      }
      if (pivotRow !== col) {
        const tmp = a[col];
        a[col] = a[pivotRow];
        a[pivotRow] = tmp;
      }
      const pivot = a[col][col];
      for (let row = col + 1; row < 3; row++) {
        const factor = a[row][col] / pivot;
        if (!Number.isFinite(factor)) return null;
        for (let k = col; k < 4; k++) {
          a[row][k] -= factor * a[col][k];
        }
      }
    }

    const sol = [0, 0, 0];
    for (let row = 2; row >= 0; row--) {
      let sum = a[row][3];
      for (let col = row + 1; col < 3; col++) {
        sum -= a[row][col] * sol[col];
      }
      const val = sum / a[row][row];
      if (!Number.isFinite(val)) return null;
      sol[row] = val;
    }
    return sol;
  }

  /**
   * Run Levenberg-Marquardt nonlinear least squares from a starting guess.
   * @param {number[]} xs
   * @param {number[]} ys
   * @param {number[]} initialParams
   * @returns {{ params: number[], sse: number } | null}
   */
  function runLM(xs, ys, initialParams) {
    let a = initialParams[0];
    let b = initialParams[1];
    let c = initialParams[2];

    const n = xs.length;
    const evalState = (pa, pb, pc) => {
      if (!Number.isFinite(pa) || !Number.isFinite(pb) || !Number.isFinite(pc)) {
        return null;
      }
      if (pa <= 0 || pb <= 0 || pc <= 0 || pa > 500 || pb > 1e5 || pc > 5) {
        return null;
      }
      let sse = 0;
      const residuals = new Array(n);
      const jac = new Array(n);
      for (let i = 0; i < n; i++) {
        const x = xs[i];
        const expCx = Math.exp(-c * x);
        // Recompute using candidate parameters
        void expCx;
        const u = Math.exp(-pc * x);
        const v = Math.exp(-pb * u);
        const pred = pa * v;
        if (!Number.isFinite(pred)) return null;
        const r = ys[i] - pred;
        residuals[i] = r;
        sse += r * r;
        jac[i] = [v, -pa * v * u, pa * v * pb * u * x];
      }
      if (!Number.isFinite(sse)) return null;
      return { sse, residuals, jac };
    };

    let state = evalState(a, b, c);
    if (!state) return null;

    let lambda = 1e-3;
    const maxIters = 500;

    for (let iter = 0; iter < maxIters; iter++) {
      const jtj = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      const jtr = [0, 0, 0];

      for (let i = 0; i < n; i++) {
        const row = state.jac[i];
        const r = state.residuals[i];
        for (let p = 0; p < 3; p++) {
          jtr[p] += row[p] * r;
          for (let q = 0; q < 3; q++) {
            jtj[p][q] += row[p] * row[q];
          }
        }
      }

      const damped = [
        [jtj[0][0] + lambda * Math.max(jtj[0][0], 1e-8), jtj[0][1], jtj[0][2]],
        [jtj[1][0], jtj[1][1] + lambda * Math.max(jtj[1][1], 1e-8), jtj[1][2]],
        [jtj[2][0], jtj[2][1], jtj[2][2] + lambda * Math.max(jtj[2][2], 1e-8)],
      ];

      const step = solve3x3(damped, jtr);
      if (!step) {
        lambda *= 10;
        if (lambda > 1e12) break;
        continue;
      }

      const stepNormSq = step[0] * step[0] + step[1] * step[1] + step[2] * step[2];
      const na = a + step[0];
      const nb = b + step[1];
      const nc = c + step[2];

      const candidate = evalState(na, nb, nc);
      if (candidate && candidate.sse <= state.sse) {
        const relImprove = Math.abs(state.sse - candidate.sse) / Math.max(state.sse, 1e-12);
        a = na;
        b = nb;
        c = nc;
        state = candidate;
        lambda = Math.max(lambda * 0.3, 1e-12);
        if (stepNormSq < 1e-16 || relImprove < 1e-12) {
          break;
        }
      } else {
        lambda *= 10;
        if (lambda > 1e12) break;
      }
    }

    return { params: [a, b, c], sse: state.sse };
  }

  /**
   * Fit a Gompertz curve to puppy measurements matching multi_puppy_chart.py.
   * Requires at least 4 finite positive points.
   * @param {Array<{ week: number, height: number }>} points
   */
  function fitGompertz(points) {
    if (!Array.isArray(points)) return null;

    const clean = points
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

    if (clean.length < 4) return null;

    const xs = clean.map((p) => p.week);
    const ys = clean.map((p) => p.height);
    const yLast = ys[ys.length - 1];
    const yMax = Math.max(...ys);
    const yMin = Math.min(...ys);

    // Reject completely flat data where curve asymptote is unidentifiable
    if (yMax - yMin < 1e-9 || xs[xs.length - 1] - xs[0] < 1e-9) {
      return null;
    }

    // Primary guess matches multi_puppy_chart.py: [y_data.iloc[-1] + 5, 5, 0.15]
    const guesses = [
      [yLast + 5, 5, 0.15],
      [yMax * 1.15, 3, 0.12],
      [yMax * 1.08, 2, 0.08],
    ];

    let best = null;
    for (const guess of guesses) {
      const result = runLM(xs, ys, guess);
      if (!result) continue;
      const [a, b, c] = result.params;
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
      if (a <= 0 || b <= 0 || c <= 0 || a > 300) continue;
      if (!best || result.sse < best.sse) {
        best = result;
      }
      // If primary guess converged cleanly, mirror SciPy's primary fit
      if (guess === guesses[0] && result.sse < clean.length * 4) {
        break;
      }
    }

    if (!best) return null;

    const [a, b, c] = best.params;
    const extendedWeeks = linspace(4, 52, 100);
    const projectedHeights = extendedWeeks.map((w) => gompertz(w, a, b, c));
    if (projectedHeights.some((h) => !Number.isFinite(h))) {
      return null;
    }

    const meanY = ys.reduce((acc, v) => acc + v, 0) / ys.length;
    let tss = 0;
    for (let i = 0; i < ys.length; i++) {
      const diff = ys[i] - meanY;
      tss += diff * diff;
    }
    const rmse = Math.sqrt(best.sse / ys.length);
    const rSquared = tss > 1e-12 ? Math.max(0, 1 - best.sse / tss) : 1;

    return {
      params: [a, b, c],
      a,
      b,
      c,
      rmse,
      rSquared,
      projectedWeek52: gompertz(52, a, b, c),
      curve: {
        x: extendedWeeks,
        y: projectedHeights,
      },
    };
  }

  const api = {
    gompertz,
    linspace,
    fitGompertz,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.PuppyGompertz = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
