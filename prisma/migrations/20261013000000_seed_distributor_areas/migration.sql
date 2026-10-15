INSERT INTO "DistributorArea" ("id", "name")
VALUES
  ('default_distributor_area_donghai', '东海'),
  ('default_distributor_area_ketang', '可塘'),
  ('default_distributor_area_online', '网络')
ON CONFLICT ("name") DO NOTHING;
