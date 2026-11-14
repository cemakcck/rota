// Trip times are zone-sensitive; running tests in a far-off zone makes TZ bugs fail loudly.
process.env.TZ = "America/New_York";
