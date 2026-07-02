import { expect, it } from "vitest";
import { migrate } from "./settings-service";

it("coerces right panel pixel widths as a positive safe-id map", () => {
  const settings = migrate({
    version: 2,
    layout: {
      rightPanelWidthsPx: {
        skills: 500,
        browser: 720.5,
        zero: 0,
        negative: -1,
        nan: Number.NaN,
        "api-key": 640,
      },
    },
  });

  expect(settings.layout?.rightPanelWidthsPx).toEqual({
    skills: 500,
    browser: 720.5,
  });
});

it("preserves legacy rightPanelWidthPct while accepting per-route pixel widths", () => {
  const settings = migrate({
    version: 2,
    layout: {
      rightPanelWidthPct: 30,
      rightPanelWidthsPx: { terminal: 760 },
    },
  });

  expect(settings.layout).toMatchObject({
    rightPanelWidthPct: 30,
    rightPanelWidthsPx: { terminal: 760 },
  });
});
