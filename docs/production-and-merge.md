# Production facilities and unit merging

## Production facilities

New scenarios use the `facility-v2` production rule:

- `factory` produces ground units.
- `airport` produces air units.
- `port` produces naval units.

The rules are data-driven from `unitDefinitions`, so the command layer, CPU, UI, scenario editor, and persistence all use the same facility mapping. Built-in scenarios that start with aircraft receive an owned, empty airport near their starting air force.

Custom scenario JSON written before airports were introduced may omit `productionRules`. Those scenarios use `legacy-factory-air`, which keeps aircraft production at factories. Newly saved custom scenarios persist the selected rule explicitly, so adding an airport is opt-in for new scenario definitions.

This follows the classic Wars-series separation of ground bases, airports, and seaports. The [Super Famicom Wars reference](https://gamefaqs.gamespot.com/snes/577448-super-famicom-wars/faqs/16941) describes ground units at bases/HQ, air units at airports, and naval units at seaports.

## Unit merging

Two adjacent allied units of the same merge-compatible kind can be combined from the selected-unit action panel. The unit with higher HP keeps its ID and position; HP, fuel, and ammunition are added with their normal per-unit caps. The resulting unit is marked as moved and acted, and transports remain non-mergeable.
