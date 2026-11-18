"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const plan = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/routines/m15.json"), "utf8"));

function names(day) {
  return day.blocks.flatMap((block) => block.exercises.map((exercise) => exercise.name));
}

function findExercise(dayLabel, exerciseName) {
  const day = plan.days.find((item) => item.label === dayLabel);
  assert.ok(day, dayLabel);
  const exercise = day.blocks.flatMap((block) => block.exercises).find((item) => item.name === exerciseName);
  assert.ok(exercise, dayLabel + " / " + exerciseName);
  return exercise;
}

test("M15 trae los cuatro días de Post-Temp A: lunes, martes, jueves y viernes", () => {
  assert.equal(plan.version, 1);
  assert.equal(plan.category, "m15");
  assert.equal(plan.sourceName, "Post-Temp A (M15)");
  assert.equal(plan.week, "47-50");
  assert.equal(plan.period, "Postemporada A");
  assert.deepEqual(plan.days.map((day) => day.label), ["Lunes", "Martes", "Jueves", "Viernes"]);
  assert.deepEqual(plan.days.map((day) => day.weekday), [1, 2, 4, 5]);
  assert.deepEqual(plan.days.map((day) => day.session), ["Día 1", "Día 2", "Día 3", "Día 4"]);
  assert.equal(plan.days.find((day) => day.session === "Día 3").label, "Jueves");
  assert.equal(plan.days.find((day) => day.session === "Día 3").weekday, 4);
  assert.equal(plan.days.find((day) => day.session === "Día 4").label, "Viernes");
  assert.equal(plan.days.find((day) => day.session === "Día 4").weekday, 5);
});

test("cada día sigue el orden de la planilla", () => {
  assert.deepEqual(names(plan.days[0]), [
    "Foam Roller",
    "Kneeling Glute Stretch",
    "Adductor Stretch",
    "Downward Dog",
    "Scorpion",
    "Good Moning c/barra",
    "Plancha c/disco · Forwards",
    "Plancha c/disco · Backs",
    "Pecho Plano c/barra",
    "Press de Pecho Inclinado c/DB",
    "Aperturas en Peck Deck",
    "Press Pecho Plano Unilateral c/DB + Flexiones de rechazo",
    "Press Fracnes + Jalones Unilarerales en Polea alta + Fondos en Triceps",
    "Regenerativo",
    "Estiramiento",
  ]);
  assert.deepEqual(names(plan.days[1]), [
    "Foam Roller",
    "Prisoner Good Morning",
    "Adductor Stretch",
    "Hip Circles",
    "Plate Wraps",
    "Revolver la Olla en FitBall",
    "Plancha 2 apoyos",
    "Sentadilla Atras c/barra",
    "Peso Muerto Rumano",
    "Sentadilla Bulgara",
    "Camilla Femoral Sentado",
    "Extensiones de Gemelo Parado c/DB",
    "Regenerativo",
    "Estiramiento",
  ]);
  assert.deepEqual(names(plan.days[2]), [
    "Foam Roller",
    "Kneeling Glute Stretch",
    "Adductor Stretch",
    "Downward Dog",
    "Good Moning c/barra",
    "Plancha c/disco · Forwards",
    "Plancha c/disco · Backs",
    "Dominadas (toma supina)",
    "Remo Tumbado",
    "Serrucho c/DB (apoyo en banco)",
    "Press de Hombro c/DB",
    "Vuelo Unilateral en banco Inclinado + Vuelo Frontal c/disco (agarre de dedos)",
    "Curl de Biceps c/barra + Martillo c/DB Alternado + ISO c/barra",
    "Flexiones de Cuello c/arnes + ISO Cuello c/banda",
    "Regenerativo",
    "Estiramiento",
  ]);
  assert.deepEqual(names(plan.days[3]), [
    "Foam Roller",
    "Prisoner Good Morning",
    "Adductor Stretch",
    "Hip Circles",
    "Plate Wraps",
    "Revolver la Olla en FitBall",
    "Plancha 2 apoyos",
    "Hip-Thrust",
    "Sentadilla Frontal",
    "Step Up c/DB",
    "Peso Muerto Unilateral c/DB",
    "Curl Nordico Asitido",
    "Extensiones de Gemelo Parado c/DB",
    "Regenerativo",
    "Estiramiento",
  ]);
});

test("las cargas, pausas y videos quedan en la columna que dice la planilla", () => {
  const pecho = findExercise("Lunes", "Pecho Plano c/barra");
  assert.equal(pecho.sets, 4);
  assert.equal(pecho.reps, "12");
  assert.equal(pecho.intensity, "65%");
  assert.equal(pecho.rest, "Pausa 90\"");
  assert.match(pecho.notes, /Pausa de 2"/);

  const scorpion = findExercise("Lunes", "Scorpion");
  assert.equal(scorpion.reps, "5 c/l");
  assert.equal(scorpion.videos[0].url, "https://www.youtube.com/shorts/_1Wxep53hG0");

  const forwards = findExercise("Lunes", "Plancha c/disco · Forwards");
  assert.equal(forwards.sets, 1);
  assert.equal(forwards.reps, "90\" - 120\"");
  assert.equal(forwards.rest, undefined);

  const backs = findExercise("Lunes", "Plancha c/disco · Backs");
  assert.equal(backs.sets, 2);
  assert.equal(backs.reps, "60\"");
  assert.equal(backs.rest, "Pausa 60\"");

  const unilateral = findExercise("Lunes", "Press Pecho Plano Unilateral c/DB + Flexiones de rechazo");
  assert.equal(unilateral.reps, "12 + AMRAP");
  assert.match(unilateral.notes, /brazo/);

  const sentadilla = findExercise("Martes", "Sentadilla Atras c/barra");
  assert.equal(sentadilla.sets, 4);
  assert.equal(sentadilla.reps, "8");
  assert.equal(sentadilla.intensity, "70%");
  assert.equal(sentadilla.rest, "Micropausa 90\"");
  assert.match(sentadilla.notes, /3 - 2 - X - 0/);

  const rumano = findExercise("Martes", "Peso Muerto Rumano");
  assert.equal(rumano.intensity, "RIR 3");
  assert.equal(rumano.reps, "8 - 10");

  const camilla = findExercise("Martes", "Camilla Femoral Sentado");
  assert.equal(camilla.intensity, "50%");

  const gemelo = findExercise("Martes", "Extensiones de Gemelo Parado c/DB");
  assert.equal(gemelo.rest, "Micropausa 2 min.");
  assert.equal(gemelo.videos[0].url, "https://www.youtube.com/watch?v=c5Kv6-fnTj8");

  const dominadas = findExercise("Jueves", "Dominadas (toma supina)");
  assert.equal(dominadas.sets, 4);
  assert.equal(dominadas.reps, "8 - 10");
  assert.equal(dominadas.rest, "Micropausa 90\"");

  const remo = findExercise("Jueves", "Remo Tumbado");
  assert.equal(remo.sets, 4);
  assert.equal(remo.reps, "8");
  assert.equal(remo.intensity, "RIR 2 - 3");

  const vuelos = findExercise("Jueves", "Vuelo Unilateral en banco Inclinado + Vuelo Frontal c/disco (agarre de dedos)");
  assert.equal(vuelos.sets, 3);
  assert.equal(vuelos.reps, "8 - 10 c/l + 12");
  assert.equal(vuelos.intensity, "RIR 2 - 3");
  assert.equal(vuelos.rest, undefined);

  const curl = findExercise("Jueves", "Curl de Biceps c/barra + Martillo c/DB Alternado + ISO c/barra");
  assert.equal(curl.reps, "12 + 8 - 10 c/l + 20\"");
  assert.equal(curl.rest, "Micropausa 90\"");

  const hip = findExercise("Viernes", "Hip-Thrust");
  assert.equal(hip.sets, 4);
  assert.equal(hip.reps, "8 - 10");
  assert.equal(hip.intensity, "75%");
  assert.equal(hip.rest, "Micropausa 2 min.");

  const frontal = findExercise("Viernes", "Sentadilla Frontal");
  assert.equal(frontal.intensity, "RIR 2 - 3");
  assert.equal(frontal.rest, "Micropausa 2 min.");

  const nordico = findExercise("Viernes", "Curl Nordico Asitido");
  assert.equal(nordico.sets, 2);
  assert.equal(nordico.reps, "4 - 6");
  assert.equal(nordico.videos[0].url, "https://www.youtube.com/shorts/o40Zd3WRbxg");

  const adductorLunes = findExercise("Lunes", "Adductor Stretch");
  assert.equal(adductorLunes.reps, "3×10\"");
  const adductorMartes = findExercise("Martes", "Adductor Stretch");
  assert.equal(adductorMartes.reps, "2×10");
});

test("la movilidad es una sola pasada y cada video es un enlace", () => {
  for (const day of plan.days) {
    const mobility = day.blocks.find((block) => /Elongación/.test(block.title));
    assert.ok(mobility, day.label);
    assert.match(mobility.note, /una sola vez/);
    assert.ok(mobility.exercises.every((exercise) => exercise.check === true));
  }
  const ids = [];
  for (const day of plan.days) {
    for (const block of day.blocks) {
      for (const exercise of block.exercises) {
        ids.push(exercise.id);
        for (const video of exercise.videos || []) assert.match(video.url, /^https:\/\//);
      }
    }
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 60);
  assert.equal(plan.reference.length, 9);
  assert.equal(plan.ranges.length, 4);
});
