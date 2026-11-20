"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { restSeconds } = require("../public/rest");

test("el descanso de la planilla pasa a segundos", () => {
  assert.equal(restSeconds('Pausa 30"'), 30);
  assert.equal(restSeconds('Pausa 90"'), 90);
  assert.equal(restSeconds('Micropausa 90"'), 90);
  assert.equal(restSeconds("Micropausa 2 min."), 120);
  assert.equal(restSeconds("1:30"), 90);
  assert.equal(restSeconds(""), 0);
  assert.equal(restSeconds("sin tiempo"), 0);
});
