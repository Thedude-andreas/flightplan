-- Seed for competency module:
-- 1. Creates county departments for all Swedish county letters.
-- 2. Creates groups from pyramid.xlsx (current workbook contains BD groups only).
-- 3. Creates an initial course catalog based on the legacy screen layout.

with department_seeds(code) as (
  values
    ('AB'),
    ('C'),
    ('D'),
    ('E'),
    ('F'),
    ('G'),
    ('H'),
    ('I'),
    ('K'),
    ('M'),
    ('N'),
    ('O'),
    ('S'),
    ('T'),
    ('U'),
    ('W'),
    ('X'),
    ('Y'),
    ('Z'),
    ('AC'),
    ('BD')
)
insert into public.competency_departments (name)
select code
from department_seeds
on conflict (name) do nothing;

with group_seeds(department_code, group_code, group_name) as (
  values
    ('BD', 'BD-FIG1', 'BD FIG 1 Syd Norrbotten'),
    ('BD', 'BD-FIG2', 'BD FIG 2 Nord Norrbotten'),
    ('BD', 'BD-HV1', 'BD 104 Lapplandsjägargruppen'),
    ('BD', 'BD-HV2', 'BD 116 Gränsjägargruppen'),
    ('BD', 'BD-HV3', 'BD 126 Norrbottensgruppen'),
    ('BD', 'BD-RG1', 'BD RG Nord Norrbotten'),
    ('BD', 'BD-RG2', 'BD RG Syd Norrbotten'),
    ('BD', 'BD-SJ', 'Sjöövervakning Norrbotten'),
    ('BD', 'BD-UAS', 'UAS insatsgrupp'),
    ('BD', 'BD-UNG', 'BD Ungdom')
)
insert into public.competency_groups (department_id, name)
select departments.id, group_seeds.group_name
from group_seeds
join public.competency_departments departments on departments.name = group_seeds.department_code
on conflict (department_id, name) do nothing;

with course_seeds(course_code, title, category, description, gu_validity_months, ru_validity_months, notification_lead_days, active) as (
  values
    ('BAS-GRUNDKURS', 'Grundkurs', 'BAS', 'Grundutbildning för basnivå enligt legacy-registret.', null::integer, null::integer, 30, true),
    ('BAS-OMA', 'OM-A utbildning', 'BAS', 'Operativ utbildning OM-A enligt legacy-registret.', null::integer, null::integer, 30, true),
    ('BAS-LAGFLYG', 'Lågflyg', 'BAS', 'Lågflygsutbildning enligt legacy-registret.', null::integer, null::integer, 30, true),
    ('BAS-UWE', 'UWE', 'BAS', 'UWE med stöd för både GU och RU i samma kurs.', null::integer, null::integer, 30, true),
    ('BAS-TBOS', 'TBOS', 'BAS', 'TBOS enligt legacy-registret.', null::integer, null::integer, 30, true),
    ('BAS-AIS', 'AIS', 'BAS', 'AIS enligt legacy-registret.', null::integer, null::integer, 30, true),
    ('BAS-SJO-VHF', 'Sjö-VHF', 'BAS', 'Sjö-VHF enligt legacy-registret.', null::integer, null::integer, 30, true),
    ('BAS-SPAN', 'Span', 'BAS', 'Span enligt legacy-registret.', null::integer, null::integer, 30, true),
    ('BAS-FOTO-BILD', 'Foto & bild', 'BAS', 'Foto- och bildutbildning enligt legacy-registret.', null::integer, null::integer, 30, true),
    ('BAS-BRANDFLYG', 'Brandflyg', 'BAS', 'Brandflyg enligt legacy-registret.', null::integer, null::integer, 30, true),
    ('BAS-SJOOVERVAKNING', 'Sjöövervakning', 'BAS', 'Sjöövervakning enligt legacy-registret.', null::integer, null::integer, 30, true),
    ('BAS-RAKEL-INTRO', 'Rakel Intro', 'BAS', 'Rakel introduktion enligt legacy-registret.', null::integer, null::integer, 30, true),
    ('FIG-VAG-JARNVAG', 'Väg och järnväg', 'FIG', 'FIG Väg och järnväg.', null::integer, null::integer, 30, true),
    ('FIG-SAR', 'SAR', 'FIG', 'FIG SAR.', null::integer, null::integer, 30, true),
    ('FIG-GSAR', 'GSAR', 'FIG', 'FIG GSAR.', null::integer, null::integer, 30, true),
    ('FIG-RADIAK', 'Radiak', 'FIG', 'FIG Radiak.', null::integer, null::integer, 30, true),
    ('FIG-PEJLING', 'Pejling', 'FIG', 'FIG Pejling.', null::integer, null::integer, 30, true),
    ('FIG-KRAFTNAT', 'Kraftnät', 'FIG', 'FIG Kraftnät med GU/KU/teori spår samlat i ett kursregisterspost tills vidare.', null::integer, null::integer, 30, true),
    ('FIG-STRALNINGSMATNING', 'Strålningsmätning', 'FIG', 'FIG Strålningsmätning.', null::integer, null::integer, 30, true),
    ('HV-GUF-GMU', 'GUF/GMU', 'HV', 'HV GUF/GMU.', null::integer, null::integer, 30, true),
    ('HV-SPAN', 'Span', 'HV', 'HV Span med stöd för både GU och RU i samma kurs.', null::integer, null::integer, 30, true),
    ('HV-MEK', 'Mek', 'HV', 'HV Mek.', null::integer, null::integer, 30, true),
    ('HV-MORKER', 'Mörker', 'HV', 'HV Mörker.', null::integer, null::integer, 30, true),
    ('HV-STRIL', 'STRIL', 'HV', 'HV STRIL.', null::integer, null::integer, 30, true),
    ('HV-OVERLEVNAD', 'Överlevnad', 'HV', 'HV KU Överlevnad.', null::integer, null::integer, 30, true),
    ('HV-MALGANG', 'Målgång', 'HV', 'HV KU Målgång.', null::integer, null::integer, 30, true),
    ('SIG-GRUNDKURS', 'Grundkurs', 'SIG', 'SIG Grundkurs.', null::integer, null::integer, 30, true),
    ('SIG-ROTE', 'Rote', 'SIG', 'SIG Rote med stöd för både GU och RU i samma kurs.', null::integer, null::integer, 30, true),
    ('SIG-MORKER', 'Mörker', 'SIG', 'SIG Mörker.', null::integer, null::integer, 30, true),
    ('SIG-SPAN', 'Span', 'SIG', 'SIG Span.', null::integer, null::integer, 30, true),
    ('SIG-OVERLEVNAD', 'Överlevnad', 'SIG', 'SIG Överlevnad.', null::integer, null::integer, 30, true),
    ('SIG-STRIL', 'STRIL', 'SIG', 'SIG STRIL.', null::integer, null::integer, 30, true),
    ('SIG-SAR', 'SAR', 'SIG', 'SIG SAR.', null::integer, null::integer, 30, true),
    ('SIG-MALGANG', 'Målgång', 'SIG', 'SIG KU Målgång.', null::integer, null::integer, 30, true),
    ('YP-GRUNDKURS', 'Grundkurs', 'YP', 'YP Grundkurs.', null::integer, null::integer, 30, true),
    ('YP-FORTSATTNING', 'Fortsättning', 'YP', 'YP Fortsättning.', null::integer, null::integer, 30, true),
    ('YP-SPANING', 'Spaning', 'YP', 'YP Spaning.', null::integer, null::integer, 30, true),
    ('YP-LEDARUTBILDNING', 'Ledarutbildning', 'YP', 'YP Ledarutbildning.', null::integer, null::integer, 30, true),
    ('YP-LAGER-LULEA', 'Läger Luleå', 'YP', 'YP Läger Luleå.', null::integer, null::integer, 30, true),
    ('YP-LAGER-LINKOPING', 'Läger Linköping', 'YP', 'YP Läger Linköping.', null::integer, null::integer, 30, true),
    ('YP-LAGER-SATENAS', 'Läger Såtenäs', 'YP', 'YP Läger Såtenäs.', null::integer, null::integer, 30, true),
    ('UAS-BASIC', 'Basic', 'UAS/Drönare', 'UAS Basic.', null::integer, null::integer, 30, true),
    ('UAS-EXTRA-1', 'Extra 1', 'UAS/Drönare', 'UAS Extra 1.', null::integer, null::integer, 30, true),
    ('UAS-EXTRA-2', 'Extra 2', 'UAS/Drönare', 'UAS Extra 2.', null::integer, null::integer, 30, true),
    ('UAS-EXTRA-3', 'Extra 3', 'UAS/Drönare', 'UAS Extra 3.', null::integer, null::integer, 30, true)
)
insert into public.competency_courses (
  course_code,
  title,
  category,
  description,
  gu_validity_months,
  ru_validity_months,
  notification_lead_days,
  active
)
select
  course_code,
  title,
  category,
  description,
  gu_validity_months,
  ru_validity_months,
  notification_lead_days,
  active
from course_seeds
on conflict (course_code) do update
set
  title = excluded.title,
  category = excluded.category,
  description = excluded.description,
  gu_validity_months = excluded.gu_validity_months,
  ru_validity_months = excluded.ru_validity_months,
  notification_lead_days = excluded.notification_lead_days,
  active = excluded.active;
