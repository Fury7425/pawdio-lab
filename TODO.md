# Database Page Hierarchical View - Implementation Plan

## Task: Redesign database tab to show results sorted by device name, then tests by date

### Steps:

1. [x] Update model.ts - Add deviceName field to ResultEntry type
2. [x] Update use-pawdio-lab.ts - Capture device name when saving results
3. [x] Update database-page.tsx - Implement hierarchical view:
   - Default sort by device name
   - Click device to see tests sorted by date
   - Click test to see result details
   - Add image/text toggle for viewing results
