// Working Day arithmetic checks (plain node): node test/workdays.test.mjs
import { addWD, wdBetween, isWD, holidays } from '../js/workdays.js';
let pass = 0, fail = 0; const eq = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log('FAIL ' + name + ': got ' + got + ', want ' + want); } };
const N = { region: 'Auckland / Northland' };
eq('2026 holidays', [...holidays(2026, N.region)].sort(), ['2026-01-26', '2026-02-06', '2026-04-03', '2026-04-06', '2026-04-27', '2026-06-01', '2026-07-10', '2026-10-26']);
eq('2027 holidays', [...holidays(2027, N.region)].sort(), ['2027-02-01', '2027-02-08', '2027-03-26', '2027-03-29', '2027-04-26', '2027-06-07', '2027-06-25', '2027-10-25']);
eq('weekend', isWD('2026-11-28', N), false); eq('shutdown start', isWD('2026-12-24', N), false); eq('shutdown end', isWD('2027-01-05', N), false); eq('first day back', isWD('2027-01-06', N), true);
eq('labour day', isWD('2026-10-26', N), false);
eq('20 WD from 30 Sep 2026 (over Labour Day)', addWD('2026-09-30', 20, N), '2026-10-29');
eq('20 WD from 7 Oct 2026', addWD('2026-10-07', 20, N), '2026-11-05');
eq('10 WD from 18 Dec 2026 (over the shutdown)', addWD('2026-12-18', 10, N), '2027-01-14');
eq('between is the inverse of add', wdBetween('2026-09-30', '2026-10-29', N), 20);
eq('negative', wdBetween('2026-10-29', '2026-09-30', N), -20); eq('same day', wdBetween('2026-10-01', '2026-10-01', N), 0);
eq('back 5 WD', addWD('2026-10-29', -5, N), '2026-10-21');
eq('extra day off', addWD('2026-11-02', 1, { region: N.region, extra: ['2026-11-03'] }), '2026-11-04');
console.log(`${pass} passed, ${fail} failed`); if (fail) process.exit(1);
