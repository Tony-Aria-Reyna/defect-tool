// Typical defects library: quick-pick templates for the editor, and a vocabulary Gemini uses for consistent titles.
// Fields: t title, d description, a action, tr trade, ty type, s severity, el element, r rooms (hint only).
export const TYPICALS = [
  // Painting
  { t: 'Paint runs on wall', d: 'Paint runs and sags visible on the wall finish.', a: 'Sand back and recoat to an even finish.', tr: 'Painting & finishes', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Paint finish' },
  { t: 'Paint holidays / misses', d: 'Thin or missed areas in the paint coat, substrate showing through.', a: 'Apply additional coat to achieve full coverage.', tr: 'Painting & finishes', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Paint finish' },
  { t: 'Paint overspray on fittings', d: 'Overspray or paint on hardware, fittings or joinery.', a: 'Clean off and make good.', tr: 'Painting & finishes', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Paint finish' },
  { t: 'Stopping visible through paint', d: 'Plaster stopping and joints visible through the paint finish (grinning).', a: 'Re-stop, sand and recoat.', tr: 'Linings & ceilings', ty: 'Workmanship / rework', s: 'Minor defect', el: 'GIB lining' },
  { t: 'Ceiling crack / popped fixing', d: 'Crack or popped fixing in the ceiling lining.', a: 'Refix, stop and repaint.', tr: 'Linings & ceilings', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Ceiling lining' },
  // Sealants and joinery
  { t: 'Sealant incomplete to benchtop', d: 'Sealant missing or incomplete at the benchtop to wall junction.', a: 'Apply continuous sealant bead.', tr: 'Joinery & kitchens', ty: 'Incomplete / omission', s: 'Minor defect', el: 'Benchtop sealant', r: 'Kitchen' },
  { t: 'Sealant incomplete to vanity', d: 'Sealant missing or patchy around the vanity top and splashback.', a: 'Apply continuous sealant bead.', tr: 'Joinery & kitchens', ty: 'Incomplete / omission', s: 'Minor defect', el: 'Vanity sealant', r: 'Bathroom' },
  { t: 'Shower tray silicone patchy', d: 'Silicone to the shower tray and wall junction is patchy or incomplete.', a: 'Remove and reapply silicone to the full junction.', tr: 'Plumbing & drainage', ty: 'Workmanship / rework', s: 'Major - prevents PC', el: 'Shower tray', r: 'Bathroom' },
  { t: 'Cupboard door misaligned', d: 'Kitchen or wardrobe door out of alignment with gaps uneven.', a: 'Adjust hinges to align doors and even gaps.', tr: 'Joinery & kitchens', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Joinery doors' },
  { t: 'Benchtop chipped', d: 'Chip or damage to the benchtop edge or surface.', a: 'Repair or replace to match.', tr: 'Joinery & kitchens', ty: 'Damage', s: 'Minor defect', el: 'Benchtop', r: 'Kitchen' },
  { t: 'Splashback scratched', d: 'Scratch on the glass splashback.', a: 'Replace splashback panel.', tr: 'Joinery & kitchens', ty: 'Damage', s: 'Minor defect', el: 'Splashback', r: 'Kitchen' },
  // Doors and hardware
  { t: 'Door not latching', d: 'Door does not latch when closed.', a: 'Adjust strike plate and latch.', tr: 'Doors & hardware', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Door hardware' },
  { t: 'Door rubbing on frame or floor', d: 'Door binds on the frame or floor covering when operated.', a: 'Ease and adjust door and hinges.', tr: 'Doors & hardware', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Door' },
  { t: 'Door closer slams', d: 'Door closer not adjusted; door slams or fails to close fully.', a: 'Adjust closer speed and latching action.', tr: 'Doors & hardware', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Door closer' },
  { t: 'Door handle loose', d: 'Lever handle loose on the spindle.', a: 'Tighten and secure fixings.', tr: 'Doors & hardware', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Door hardware' },
  { t: 'Door stop missing', d: 'No door stop fitted; handle will damage the wall.', a: 'Fit door stop.', tr: 'Doors & hardware', ty: 'Incomplete / omission', s: 'Minor defect', el: 'Door stop' },
  { t: 'Fire door smoke seal damaged', d: 'Smoke seal to the fire door is damaged or missing.', a: 'Replace smoke seal and confirm door closes and latches.', tr: 'Fire protection', ty: 'Non-compliance', s: 'Major - prevents PC', el: 'Fire door' },
  { t: 'Fire door tag missing', d: 'Fire door identification tag not fitted.', a: 'Fit compliant tag and provide certificate.', tr: 'Fire protection', ty: 'Documentation', s: 'Major - prevents PC', el: 'Fire door' },
  // Windows
  { t: 'Window stiff to operate', d: 'Window sash stiff or stay not operating smoothly.', a: 'Adjust hardware and lubricate.', tr: 'Windows & glazing', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Window hardware' },
  { t: 'Glass scratched', d: 'Scratch on the glazing visible from inside.', a: 'Polish out or replace glazing unit.', tr: 'Windows & glazing', ty: 'Damage', s: 'Minor defect', el: 'Glazing' },
  { t: 'Window reveal damaged', d: 'Dent or scratch to the window reveal or liner.', a: 'Repair and repaint to match.', tr: 'Windows & glazing', ty: 'Damage', s: 'Minor defect', el: 'Window reveal' },
  { t: 'Protective film on joinery', d: 'Protective film still on aluminium joinery.', a: 'Remove film and clean.', tr: 'Cleaning', ty: 'Cleaning', s: 'Minor defect', el: 'Aluminium joinery' },
  // Envelope
  { t: 'Exposed fixings on head flashing', d: 'Head flashing fixings exposed and reliant on sealant.', a: 'Rework to the consented detail with concealed fixings.', tr: 'Cladding & envelope', ty: 'Non-compliance', s: 'Major - prevents PC', el: 'Head flashing' },
  { t: 'Sealant drips on cladding', d: 'Sealant runs and drips on the cladding face.', a: 'Clean off and make good.', tr: 'Cladding & envelope', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Cladding' },
  { t: 'Cladding panel dented', d: 'Dent or damage to the metal cladding panel.', a: 'Replace panel.', tr: 'Cladding & envelope', ty: 'Damage', s: 'Minor defect', el: 'Metal cladding' },
  { t: 'Brick mortar joint defective', d: 'Mortar joint cracked, hollow or poorly struck.', a: 'Rake out and repoint.', tr: 'Brick veneer', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Brick veneer' },
  { t: 'Render cracked', d: 'Crack in the external render.', a: 'Repair crack and recoat.', tr: 'Cladding & envelope', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Render' },
  { t: 'Gutter / downpipe leak', d: 'Leak or overflow at the gutter or downpipe joint.', a: 'Reseal joint and confirm falls.', tr: 'Roofing & rainwater', ty: 'Workmanship / rework', s: 'Major - prevents PC', el: 'Rainwater' },
  { t: 'Roof debris / swarf', d: 'Swarf and debris left on the roof and in gutters.', a: 'Clean roof and gutters.', tr: 'Roofing & rainwater', ty: 'Cleaning', s: 'Minor defect', el: 'Roof' },
  // Flooring
  { t: 'Vinyl lifting at edge', d: 'Vinyl floor covering lifting at the edge or join.', a: 'Reglue and seal join.', tr: 'Floor coverings', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Vinyl flooring' },
  { t: 'Carpet join visible', d: 'Carpet join visible or edge not tucked.', a: 'Restretch and finish edge.', tr: 'Floor coverings', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Carpet' },
  { t: 'Floor waste not sealed', d: 'Floor waste not sealed to the vinyl.', a: 'Seal floor waste to vinyl.', tr: 'Plumbing & drainage', ty: 'Incomplete / omission', s: 'Minor defect', el: 'Floor waste' },
  { t: 'Skirting gap', d: 'Gap between skirting and floor or wall.', a: 'Fill and paint.', tr: 'Painting & finishes', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Skirting' },
  // Plumbing and electrical
  { t: 'Tap leaking', d: 'Tap drips or leaks at the base.', a: 'Reseal or replace cartridge.', tr: 'Plumbing & drainage', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Tapware' },
  { t: 'Waste slow to drain', d: 'Basin, sink or shower slow to drain.', a: 'Clear and check trap and fall.', tr: 'Plumbing & drainage', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Waste' },
  { t: 'Toilet seat loose', d: 'Toilet seat fixings loose.', a: 'Tighten fixings.', tr: 'Plumbing & drainage', ty: 'Workmanship / rework', s: 'Minor defect', el: 'WC', r: 'Bathroom' },
  { t: 'Socket / switch plate loose', d: 'Power point or switch plate loose or not flush to wall.', a: 'Refix flush to wall.', tr: 'Electrical', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Electrical fitting' },
  { t: 'Light not working', d: 'Light fitting not operating.', a: 'Investigate and repair.', tr: 'Electrical', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Light fitting' },
  { t: 'Extract fan noisy / not working', d: 'Bathroom or kitchen extract fan noisy or not operating.', a: 'Check and repair fan and ducting.', tr: 'Mechanical & ventilation', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Extract fan' },
  { t: 'Heat pump not operating', d: 'Heat pump not operating or remote not paired.', a: 'Commission and demonstrate.', tr: 'Mechanical & ventilation', ty: 'Incomplete / omission', s: 'Minor defect', el: 'Heat pump' },
  { t: 'Penetration not fire stopped', d: 'Service penetration through a fire-rated element not fire stopped.', a: 'Fire stop to the approved system and provide certificate.', tr: 'Fire protection', ty: 'Non-compliance', s: 'Major - prevents PC', el: 'Passive fire' },
  // Accessibility and safety
  { t: 'Grab rail missing or loose', d: 'Grab rail not fitted or not secure.', a: 'Fit and secure to blocking.', tr: 'General / builder', ty: 'Non-compliance', s: 'Major - prevents PC', el: 'Accessibility fittings', r: 'Bathroom' },
  { t: 'Balustrade loose', d: 'Balustrade or handrail moves under load.', a: 'Refix and certify.', tr: 'Balustrades & stairs', ty: 'Non-compliance', s: 'Major - prevents PC', el: 'Balustrade' },
  { t: 'Threshold not level entry', d: 'Threshold step exceeds accessible limit.', a: 'Rework threshold to level entry.', tr: 'General / builder', ty: 'Non-compliance', s: 'Major - prevents PC', el: 'Threshold' },
  // External and cleaning
  { t: 'Ponding on path or patio', d: 'Water ponding on the path, patio or deck surface.', a: 'Correct falls or add drainage.', tr: 'External works', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Paving' },
  { t: 'Landscaping incomplete', d: 'Planting, mulch or turf incomplete or dead.', a: 'Complete and replace dead stock.', tr: 'Landscaping', ty: 'Incomplete / omission', s: 'Minor defect', el: 'Landscaping' },
  { t: 'Unit number signage wrong', d: 'Unit number or letterbox number does not match the allocated address.', a: 'Replace with correct number.', tr: 'Signage', ty: 'Non-compliance', s: 'Minor defect', el: 'Signage' },
  { t: 'Builders clean required', d: 'Dust, debris, labels or marks remaining.', a: 'Builders clean.', tr: 'Cleaning', ty: 'Cleaning', s: 'Minor defect', el: 'Cleaning' },
  { t: 'Damage to wall lining', d: 'Dent, gouge or scuff to the wall lining.', a: 'Repair and repaint.', tr: 'Linings & ceilings', ty: 'Damage', s: 'Minor defect', el: 'Wall lining' },
  { t: 'Shower screen / door leaking', d: 'Water escaping past the shower screen or door.', a: 'Adjust and reseal.', tr: 'Plumbing & drainage', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Shower screen', r: 'Bathroom' },
  { t: 'Wardrobe shelf / rail loose', d: 'Wardrobe shelf or hanging rail not secure.', a: 'Refix.', tr: 'Joinery & kitchens', ty: 'Workmanship / rework', s: 'Minor defect', el: 'Wardrobe', r: 'Wardrobe' },
];
export const typicalList = p => (p && Array.isArray(p.typicals) && p.typicals.length) ? p.typicals : TYPICALS;
