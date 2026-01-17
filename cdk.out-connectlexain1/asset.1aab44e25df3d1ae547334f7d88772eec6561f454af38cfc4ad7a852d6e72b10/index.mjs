// src/services/secrets/seeder.ts
import { DynamoDBClient, BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

// src/infrastructure/configs/clinic-secrets.json
var clinic_secrets_default = [
  {
    clinicId: "dentistinnewbritain",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "rBcAexBfyBuvwpP7",
    authorizeNetApiLoginId: "5bge49tWV6hp",
    authorizeNetTransactionKey: "2K8C94V8sw5nE75e",
    gmailSmtpPassword: "alqd nvbf nohr erdz",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "BE260A0D-89684181-8BBD2B90-792038F2",
    ayrshareRefId: "96e3954b0e507953e8671586286b4969d69b1385",
    rcsSenderId: "rcs:dentist_in_new_britain_txaonpqu_agent"
  },
  {
    clinicId: "dentistingreenville",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "6NSvxIK5kBLODZzt",
    authorizeNetApiLoginId: "3aj94FZq",
    authorizeNetTransactionKey: "5h9xRz27U3J27m23",
    gmailSmtpPassword: "oqcs wpqw jgrr ugjg",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "646132A1-1CD34F46-A907D7DA-BAC10BC6",
    ayrshareRefId: "8d6d62a0c2924403c1ec895d26e15b655f22429e"
  },
  {
    clinicId: "todaysdentalcayce",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "r4cgFsuJOKtnI5O6",
    authorizeNetApiLoginId: "52hw6MPpx",
    authorizeNetTransactionKey: "5sE3cK77253yBLHG",
    gmailSmtpPassword: "cfbn kmgx nykb wpyr",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "94AC17BE-602B4B24-A2599AC7-9340F91E",
    ayrshareRefId: "382baf98b302dbb7a1d4dba5c069b74366262c1f",
    rcsSenderId: "rcs:todays_dental_cayce_mucmtr6n_agent"
  },
  {
    clinicId: "creekcrossingdentalcare",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "U3XvGKECuu1Tdfpb",
    authorizeNetApiLoginId: "2PF7j5P4f5",
    authorizeNetTransactionKey: "7c5n8eQrYb64VB99",
    gmailSmtpPassword: "gpkv lhty uhhw cvdc",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "FB5DAE3B-AB0D41D9-BFD4ABCC-211BAA65",
    ayrshareRefId: "a26c0d42406b86ca4799d53c3920f3714f4c420a"
  },
  {
    clinicId: "dentistinwinston-salem",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "50BOitz4cTeEkPa7",
    authorizeNetApiLoginId: "46bcF3B9",
    authorizeNetTransactionKey: "8Tf9dP43K289xB6Z",
    gmailSmtpPassword: "Clinic@202020212022202320242026!",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "2EB9186B-628545E9-91CD2945-08B809A5",
    ayrshareRefId: "f9e9f68367b26f4b563df5494ef4057ba2e4043c"
  },
  {
    clinicId: "dentistincentennial",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "rKQ15Y2yfIZIIFV8",
    authorizeNetApiLoginId: "REPLACE_WITH_ACTUAL_LOGIN_ID_FOR_NEW_BRITAIN",
    authorizeNetTransactionKey: "REPLACE_WITH_ACTUAL_TRANSACTION_KEY_FOR_NEW_BRITAIN",
    gmailSmtpPassword: "Clinic@202020212022202320242026!",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "261DF86D-B4544949-9CB44136-76D2BF55",
    ayrshareRefId: "006c37629a19ca44b5c089f1ad7569ac5d3aa830"
  },
  {
    clinicId: "renodentalcareandorthodontics",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "anJSTkEmWd1pYJcx",
    authorizeNetApiLoginId: "9PmqK67F",
    authorizeNetTransactionKey: "833S6a5Dm2GyUpw2",
    gmailSmtpPassword: "ennq gyjm eggq pjxr",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "57FE0AF9-AF2F40E8-9985ECF0-A4C7DFF0",
    ayrshareRefId: "1afb1c197c7e83e386f950c1ef4f9e542aed612b"
  },
  {
    clinicId: "todaysdentalalexandria",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "fFzwczDjOEhZbDJS",
    authorizeNetApiLoginId: "2GwU98fdP",
    authorizeNetTransactionKey: "4Rs2924p9dYLp4Cz",
    gmailSmtpPassword: "mwlj avjz gsqx yxit",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "E0E44D7A-57FA4026-A8B2F9A9-61002135",
    ayrshareRefId: "9a30fcb99c4e31665ca6982889502ff3e4a41545"
  },
  {
    clinicId: "todaysdentalgreenville",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "w2ajTsfp6AnUctJW",
    authorizeNetApiLoginId: "43gmpU8YPDW",
    authorizeNetTransactionKey: "2Ln5B6mB6Hu62S35",
    gmailSmtpPassword: "tluc frgj hczn srvz",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "9B56F4B4-69784AAC-88B053F0-4B5CA182",
    ayrshareRefId: "3e5dad1a752019153712fa07a1f98a8a9b5f43ab"
  },
  {
    clinicId: "todaysdentalwestcolumbia",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "sijYJwXoE7c7QuJI",
    authorizeNetApiLoginId: "35RFy7a72uMW",
    authorizeNetTransactionKey: "3vXv3TJ86n4zrF3N",
    gmailSmtpPassword: "qnfu qeov bdyf jscf",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "B33E8574-A1564A28-B998D651-1BAA17A5",
    ayrshareRefId: "5e0427146f9fd37995a1fa6123c8f266e4e9963c"
  },
  {
    clinicId: "dentistinconcord",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "fESyyB006LrpPw3F",
    authorizeNetApiLoginId: "9tMzRW9M4q2",
    authorizeNetTransactionKey: "2U2YHt4B82d33UgS",
    gmailSmtpPassword: "pykt fwaa klog gisr",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "FC19EF12-B3CF4067-801B98C6-4EE6578A",
    ayrshareRefId: "5b74dee47f18e1772572029cb85461132b993034"
  },
  {
    clinicId: "dentistinedgewater",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "l3MgN4DpOaxhadZ0",
    authorizeNetApiLoginId: "59MU3HF5qzBf",
    authorizeNetTransactionKey: "574dR4H2cH7zuA77",
    gmailSmtpPassword: "jdkf rbju wsbu veyg",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "9146A876-5F034EB3-BCC2418D-8F894A09",
    ayrshareRefId: "43a289fb12fe0b0054039d2ad384b26599016677"
  },
  {
    clinicId: "lawrencevilledentistry",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "2lCTQdQ40GgixHjg",
    authorizeNetApiLoginId: "6hq44QR22zp",
    authorizeNetTransactionKey: "2262m3VLBEc2eMcT",
    gmailSmtpPassword: "ndbb vkyb msyz bpit",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "DF03225C-BDD8481D-97A0A0C2-9BA902AE",
    ayrshareRefId: "ce15c4fac5a6cd77aa02d9ba84b6c281891ecc70"
  },
  {
    clinicId: "dentistinlouisville",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "0lQrAb38IK405RWW",
    authorizeNetApiLoginId: "6qn98TNmk",
    authorizeNetTransactionKey: "8yQ3G6Su5pc97922",
    gmailSmtpPassword: "jesx pytu xlqk ugwt",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "89C003DD-D4C44C33-8949943A-F387AB96",
    ayrshareRefId: "6af3c27dfc8d71ba67c769427da4cdbdfdf83c09"
  },
  {
    clinicId: "dentistatsaludapointe",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "HUqvIoX1lX3bGSPp",
    authorizeNetApiLoginId: "9Q6Rt7qvD2GR",
    authorizeNetTransactionKey: "4MU7e3vt7KQ5mu6X",
    gmailSmtpPassword: "tfch vbra ezwk joei",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "9B92979A-B7644964-87CA55B0-462AFCE6",
    ayrshareRefId: "3005275110fce193178d3ab5ef3311c8055faebe"
  },
  {
    clinicId: "dentistinoregonoh",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "6eSZ1WuQSRjRcdgV",
    authorizeNetApiLoginId: "98Kp8Hq3",
    authorizeNetTransactionKey: "7DpXEpj63PHR888W",
    gmailSmtpPassword: "omgy zwje xtto eypn",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "4100F2E9-603040ED-9E1C608A-9040A8C8",
    ayrshareRefId: "a58c689218e890555d55d184ce42c727a117784d"
  },
  {
    clinicId: "todaysdentallexington",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "3NGjWWFrdYTPz2qY",
    authorizeNetApiLoginId: "44t75wLUd",
    authorizeNetTransactionKey: "36zM79CW478zHgzn",
    gmailSmtpPassword: "Clinic@202020212022202320242026!",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "ECEFE1AA-54194182-972C995A-4AEE77B0",
    ayrshareRefId: "61e8f6942cf168ef4143af5ccf66c0fcf4d282cb"
  },
  {
    clinicId: "dentistinbowie",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "ohf2G7gIoxf2nryi",
    authorizeNetApiLoginId: "5k3K5wXGa",
    authorizeNetTransactionKey: "43BdW3UB5L474rtq",
    gmailSmtpPassword: "fcfp encn xcpm bzkg",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "A9A7B976-F79240A7-8BEC051F-B8EE7187",
    ayrshareRefId: "232dda9bf1f654f6678efa46b4280e14d9b8a845"
  },
  {
    clinicId: "dentistinpowellohio",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "6dPfNQLg6dIID0vG",
    authorizeNetApiLoginId: "3NbuDJ89uu",
    authorizeNetTransactionKey: "26zG9tnJWs45A5hx",
    gmailSmtpPassword: "vmih qghp axyd axgl",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "D4B98C52-A0DE4077-B8CA6522-C3C072F3",
    ayrshareRefId: "004c6a454062f84dd942217549ec8a6101f60aa9"
  },
  {
    clinicId: "dentistinperrysburg",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "Vf28QPymQvtMK1lH",
    authorizeNetApiLoginId: "83fQ5fRH",
    authorizeNetTransactionKey: "6S45JzgM94pK9R8h",
    gmailSmtpPassword: "Clinic@202020212022202320242026!",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "BCC02D46-9A584C6E-B2CF1E23-F5CEB5C3",
    ayrshareRefId: "99f124d691e0f4879f29d5e0122e9b3e63abdd45"
  },
  {
    clinicId: "dentistinaustin",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "UtXmMJ18RoVZrseX",
    authorizeNetApiLoginId: "7tj7Q4QS3D",
    authorizeNetTransactionKey: "587spNV4R373aeM6",
    gmailSmtpPassword: "jnwz igxs rmje yyfs",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "5A3E4D64-604D4521-89FFEA81-6DCA05B5",
    ayrshareRefId: "d8110ecf2451e74f50fd599d2a18325afff68859"
  },
  {
    clinicId: "therimdentalcare",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "bXc8MmtKBa1TCzio",
    authorizeNetApiLoginId: "5Wu2zYw5tPW",
    authorizeNetTransactionKey: "56gV5Fw9qqS6y359",
    gmailSmtpPassword: "rsyh rpoe buul npit",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "15F114D3-3D5F4944-9254B2B0-627DA164",
    ayrshareRefId: "a9ed655f24e4425bbef34cd865b54dfb7acaa294"
  },
  {
    clinicId: "dentistinbloomingdale",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "5MlQiWOLdZfXZYdc",
    authorizeNetApiLoginId: "534kKx7G8sXE",
    authorizeNetTransactionKey: "4Fw364pDAA86Drkc",
    gmailSmtpPassword: "jtru pqdi rjkn qrrl",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "E75505D7-69594043-8AE3C4E8-E2B77A75",
    ayrshareRefId: "7d5c5d0b9796df7a3b1d94f4ee3cd4cf80486424"
  },
  {
    clinicId: "dentistinvernonhills",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "xlIhQDibi5ciyGKa",
    authorizeNetApiLoginId: "6LZf2u7m",
    authorizeNetTransactionKey: "7FSuRK9Cv7x63833",
    gmailSmtpPassword: "sbkg immt eofb yund",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "1D424A0C-21DC4FF7-9FF1853A-B21F87EA",
    ayrshareRefId: "8fd580b77ce4ff0cc1d8d4935816f86f8f915205"
  },
  {
    clinicId: "meadowsdentalcare",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "GGmyZcAddGLaagOC",
    authorizeNetApiLoginId: "99jDTqFa27",
    authorizeNetTransactionKey: "78L9x3p9ca4B2A3r",
    gmailSmtpPassword: "ggio xers nqtv qbbx",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "E49F6636-F5614AE9-B6D13105-DDD588AF",
    ayrshareRefId: "6eb401389c4e5eaf8d9c0a0e7b66257e8675210a"
  },
  {
    clinicId: "dentistinstillwater",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "Z1SrMUZKU1j8aOeo",
    authorizeNetApiLoginId: "43KaQe2u6",
    authorizeNetTransactionKey: "824gX8y2pDkRcH6m",
    gmailSmtpPassword: "Clinic@202020212022202320242026!",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "E49F6636-F5614AE9-B6D13105-DDD588AF",
    ayrshareRefId: "6eb401389c4e5eaf8d9c0a0e7b66257e8675210a"
  },
  {
    clinicId: "pearlanddentalcare",
    openDentalDeveloperKey: "OkDBoT0iEb6O80Cy",
    openDentalCustomerKey: "EbKEZQvdQRoJbsF0",
    authorizeNetApiLoginId: "56hG4Kh4",
    authorizeNetTransactionKey: "5bdvK54j36XVz87Y",
    gmailSmtpPassword: "Clinic@202020212022202320242026!",
    domainSmtpPassword: "Clinic@202020212022202320242026!",
    ayrshareProfileKey: "EF24D206-BA8A477A-AAE572D1-8BC0A80E",
    ayrshareRefId: "62e06f057b96ec13be7a15dea3ccb15f34d43f9f"
  }
];

// src/infrastructure/configs/global-secrets.json
var global_secrets_default = [
  {
    secretId: "ayrshare",
    secretType: "api_key",
    value: "A7DD2620-39C046C1-ABAAA24C-64B16202",
    metadata: {
      description: "Ayrshare API Key for social media management"
    }
  },
  {
    secretId: "ayrshare",
    secretType: "private_key",
    value: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDIqgfoHL/oJPQb\nUd5t2Y8I24eMKys3SI9bfHsVLEFFc4WCda5pvrBb8+l0H051V4bUGdhJoeJyskur\n0Gwyn3DmnA+sopOsphdCB7QvbS4cyhIb0eqjFuRAP3pedqitleKsLPUoU0nJoOeH\nOK9Tl0hh1PJp4ozl3uWZuTVZTHSW82C/h/r0h9fB477loGWMCYdFWBt7DEDj8CqN\n8e7tSaFom8NKUFpstP1Na5cWN1QUK4/Kwmt3QiFv94e0rPmbnrCt2vO0PTIZwcj+\nmeqHRmhhCKJQ4rt1J8mLDbTXRjC3Sfooetn46zhWp1BzUUU8N34kraO+2Uj9swX8\nKmHJVPRlAgMBAAECggEAVTuLojbb+MIBgb0ziltXmv6MQ6huccv7QHPOX/7tNo/M\nDM7pp3bcuCIRbkaB7+uelGbp7NS7N9att6wO2S3KKdnt+nkP2sytolldWqu4Y3gd\nWv29+UoW54dO9eLW4OyCXHm4JEnEVMVospIMPqhKkWt/ECSvjlAwHCyEEYsdFqRG\nbTWSpPOICzRQD4M+WpaoPkIXxLur1Dp/CAdnM9JeN8i2UOYYjZEODRhx2j4JPDYh\nxitrOYNlfGsxtTjFUO6vpfGIy0t6PrH4obckYnjxJb6fZnUK1zgWOmVlRHMWem5g\nWsh9j0WG6hjHSY6y3QpTFnQAYvuUL+5WBQSVc8OtXQKBgQD5dWBHjsTW7AL1Ql2A\nW4GkucqcNeq9HG3r7+BPfWKyxQ0j+UysPHDPYwk8fxtDI8u2BDSPE85Rr3sKsJ6+\nBm4iagT9i6ZzBz2kU1hArTwwaooVbo4K0rQWkiHhhShZJ4C8jJZWSLC8HEE7nucP\nmhQSuFY4rbOSsHcnFTDomJmgKwKBgQDN7RjGwEe8H1hDxtIqx7zgSJmSX1+V0tXy\nocxvq0Jx8+p040wwmLREvVhLIk6pC4cqV6mJ1UU7V5q3OaXUkUf7mFlVnmIJcSUk\nOKJ9y5uW6Mjdc/X5PNnSKX2lhi7rn5iVoqdFwLw1N49VNepIp2Wfj0JlkVOzo6XG\n3mqTVR7lrwKBgHHryYlESN5Br+QjZ6HbqCv68O0/rjCo0AYkaNLEVxN+685W5k3t\n2DLNboVjIqcZrMk1yG7iw6EIO2+ZUxVCyH8M3bSQVvZHAz6NFUuMEWWm8eJxt4p3\nyOhZ2gEsl02HvcHdjjZfQd7WJHA+1BSK78nQxwdhRBWkYvXFNq2yKs47AoGBAI/z\nXy+IuFy8eKIgeUhoihMrDReyTgpY8TCEhHnHeVJZVRtSzS7ngJTQ28jh+aTYJyul\nTiHJEXVzPvc4eEEJMg2hqUldx2CcVH9mi8huLZynq8qKxnbtX8M3N9se2uvhi/OG\nWXI8UhTNewfxAY66XiLVLW/80Esyaa+ESXImvcuHAoGBALUQ0cLIgSPOs3GD6UxQ\nmLeIFNO6iIxHmr2tLExxuL9oy/UaY0YbuseOv7uL5bbJfJbTsazDkDCOo+j3DEnP\nQha+zBk6Bl9njkhrtdrZPoiow2WevXi9eT6+0DluulxlQGCy2ZcKGZmJDejlNHBl\nwlYXO5lFMbXxxeTKZao2DZfQ\n-----END PRIVATE KEY-----",
    metadata: {
      description: "Ayrshare Private Key for JWT signing"
    }
  },
  {
    secretId: "ayrshare",
    secretType: "domain",
    value: "id-lJiXe",
    metadata: {
      description: "Ayrshare Business Domain ID"
    }
  },
  {
    secretId: "odoo",
    secretType: "api_key",
    value: "1a0e921ab53be80da6eac315d56c400cf749ce80",
    metadata: {
      description: "Odoo API Key for bank reconciliation",
      url: "https://todays-dental-services.odoo.com",
      database: "todays-dental-services"
    }
  },
  {
    secretId: "odoo",
    secretType: "config",
    value: "https://todays-dental-services.odoo.com",
    metadata: {
      database: "todays-dental-services",
      description: "Odoo connection configuration"
    }
  },
  {
    secretId: "gmail",
    secretType: "client_id",
    value: "REPLACE_WITH_YOUR_GMAIL_CLIENT_ID.apps.googleusercontent.com",
    metadata: {
      description: "Gmail OAuth2 Client ID"
    }
  },
  {
    secretId: "gmail",
    secretType: "client_secret",
    value: "REPLACE_WITH_YOUR_GMAIL_CLIENT_SECRET",
    metadata: {
      description: "Gmail OAuth2 Client Secret"
    }
  },
  {
    secretId: "cpanel",
    secretType: "password",
    value: "James!007",
    metadata: {
      description: "cPanel password for todaysdentalpartners.com (DEPRECATED - use api_token instead)",
      host: "box2383.bluehost.com",
      port: "2083",
      user: "todayse4",
      domain: "todaysdentalpartners.com"
    }
  },
  {
    secretId: "cpanel",
    secretType: "api_token",
    value: "DXWMD3Z6D8TPPUMJ0P2SE00ZDD9XS5RK",
    metadata: {
      description: "cPanel API Token for todaysdentalpartners.com email management",
      host: "box2383.bluehost.com",
      port: "2083",
      user: "todayse4",
      domain: "todaysdentalpartners.com"
    }
  },
  {
    secretId: "cpanel",
    secretType: "config",
    value: "box2383.bluehost.com",
    metadata: {
      port: "2083",
      user: "todayse4",
      domain: "todaysdentalpartners.com",
      description: "cPanel connection configuration"
    }
  },
  {
    secretId: "twilio",
    secretType: "auth_token",
    value: "bef3aee1ffb1cbdd11b654fc33dfdd56",
    metadata: {
      description: "Twilio Auth Token for RCS messaging"
    }
  },
  {
    secretId: "twilio",
    secretType: "account_sid",
    value: "ACbc899dd5f06f5a5bf2bba9c556a67ea1",
    metadata: {
      description: "Twilio Account SID"
    }
  },
  {
    secretId: "domain_email",
    secretType: "smtp_password",
    value: "REPLACE_WITH_DOMAIN_APP_PASSWORD",
    metadata: {
      description: "Domain SMTP password for no-reply@todaysdentalinsights.com",
      user: "no-reply@todaysdentalinsights.com",
      imapHost: "imap.gmail.com",
      imapPort: 993
    }
  },
  {
    secretId: "consolidated_sftp",
    secretType: "password",
    value: "Clinic@2020!",
    metadata: {
      description: "Consolidated SFTP password for OpenDental integration (used by schedules, patient-portal, fee-schedule-sync, insurance-plan-sync)"
    }
  },
  {
    secretId: "consolidated_sftp",
    secretType: "password_alt",
    value: "Clinic2020",
    metadata: {
      description: "Alternative SFTP password for OpenDental (used by opendental-stack, fluoride-automation)"
    }
  },
  {
    secretId: "notifications",
    secretType: "unsubscribe_secret",
    value: "todays-dental-unsubscribe-secret-key-2024",
    metadata: {
      description: "Secret key for signing/verifying unsubscribe tokens"
    }
  },
  {
    secretId: "google-ads",
    secretType: "developer_token",
    value: "yf0wVh6n6pkts1inzKFP_w",
    metadata: {
      description: "Google Ads API Developer Token for campaign management"
    }
  },
  {
    secretId: "google-ads",
    secretType: "client_id",
    value: "584598112747-e6oc5dku2m7bk6m8eirn9lg4ipg0t59k.apps.googleusercontent.com",
    metadata: {
      description: "Google Ads OAuth2 Client ID"
    }
  },
  {
    secretId: "google-ads",
    secretType: "client_secret",
    value: "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",
    metadata: {
      description: "Google Ads OAuth2 Client Secret"
    }
  },
  {
    secretId: "google-ads",
    secretType: "login_customer_id",
    value: "6325322362",
    metadata: {
      description: "Google Ads MCC/Manager Account Customer ID"
    }
  },
  {
    secretId: "google-ads",
    secretType: "refresh_token",
    value: "1//0gZudlY_WOnDKCgYIARAAGBASNwF-L9Irg0_2DfIAxZJeLiz4ZDcwHenOxQcq_weW7zm6LsAaHEyyVWS3lhXA5luCqzFn4xBF-Qo",
    metadata: {
      description: "Google Ads OAuth2 Refresh Token (MCC/Manager Account level)"
    }
  }
];

// src/infrastructure/configs/clinic-config.json
var clinic_config_default = [
  {
    clinicId: "dentistinnewbritain",
    odooCompanyId: 22,
    clinicAddress: "446 S Main St, New Britain CT 06051-3516, USA",
    clinicCity: "New Britain",
    clinicEmail: "dentalcare@dentistinnewbritain.com",
    clinicFax: "(860) 770-6774",
    clinicName: "Dentist in New Britain",
    clinicZipCode: "29607",
    clinicPhone: "860-259-4141",
    clinicState: "Connecticut",
    timezone: "America/New_York",
    logoUrl: "https://dentistinnewbritain.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/1wKzE8B2jbxQJaHB8",
    scheduleUrl: "https://dentistinnewbritain.com/patient-portal",
    websiteLink: "https://dentistinnewbritain.com",
    wwwUrl: "https://www.dentistinnewbritain.com",
    phoneNumber: "+18602612866",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinnewbritain.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-e6d6091484b5474281291379879901b8",
    sftpFolderPath: "dentistinnewbritain",
    hostedZoneId: "Z01685649197DPKW71B2",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinnewbritain@gmail.com",
        fromEmail: "dentistinnewbritain@gmail.com",
        fromName: "Dentist in New Britain"
      },
      domain: {
        imapHost: "mail.dentistinnewbritain.com",
        imapPort: 993,
        smtpHost: "mail.dentistinnewbritain.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistinnewbritain.com",
        fromEmail: "dentalcare@dentistinnewbritain.com",
        fromName: "Dentist in New Britain"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "749712698232047",
        pageName: "Dentist in New Britain"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "6882337378"
    }
  },
  {
    clinicId: "dentistingreenville",
    odooCompanyId: 14,
    clinicAddress: "4 Market Point Drive Suite E, Greenville SC 29607",
    clinicCity: "Greenville",
    clinicEmail: "dentalcare@dentistingreenville.com",
    clinicFax: "864-284-0066",
    clinicName: "Dentist in Greenville",
    clinicPhone: "864-284-0066",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "06051-3516",
    logoUrl: "https://dentistingreenville.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/TP79MgS1EcycndPy8",
    scheduleUrl: "https://dentistingreenville.com/patient-portal",
    websiteLink: "https://dentistingreenville.com",
    wwwUrl: "https://www.dentistingreenville.com",
    phoneNumber: "+18643192704",
    aiPhoneNumber: "+14439272295",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistingreenville.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-b7576e8cf26a4fd49b8a221fea062922",
    sftpFolderPath: "dentistingreenville",
    hostedZoneId: "Z02737791R5YBM2QQE4CP",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistingreenville@gmail.com",
        fromEmail: "dentistingreenville@gmail.com",
        fromName: "Dentist in Greenville"
      },
      domain: {
        imapHost: "mail.dentistingreenville.com",
        imapPort: 993,
        smtpHost: "mail.dentistingreenville.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistingreenville.com",
        fromEmail: "dentalcare@dentistingreenville.com",
        fromName: "Dentist in Greenville"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "749186571616901",
        pageName: "Dentist in Greenville"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "2978902821"
    }
  },
  {
    clinicId: "todaysdentalcayce",
    odooCompanyId: 4,
    clinicAddress: "1305 Knox Abbott Dr suite 101, Cayce, SC 29033, United States",
    clinicCity: "Cayce",
    clinicEmail: "Dentist@TodaysDentalCayce.com",
    clinicFax: "(803) 753-1442",
    clinicName: "Todays Dental Cayce",
    clinicPhone: "803-233-6141",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "29033",
    logoUrl: "https://todaysdentalcayce.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/eU4TuxoySfuqfwib7",
    scheduleUrl: "https://todaysdentalcayce.com/patient-portal",
    websiteLink: "https://todaysdentalcayce.com",
    wwwUrl: "https://www.todaysdentalcayce.com",
    phoneNumber: "+18033027525",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentalcayce.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-add5c4f5f7cd489499c8910e3caf8aef",
    sftpFolderPath: "todaysdentalcayce",
    hostedZoneId: "Z0652651QLHSQU2T54IO",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentalcayce@gmail.com",
        fromEmail: "todaysdentalcayce@gmail.com",
        fromName: "Todays Dental Cayce"
      },
      domain: {
        imapHost: "mail.todaysdentalcayce.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentalcayce.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalCayce.com",
        fromEmail: "Dentist@TodaysDentalCayce.com",
        fromName: "Todays Dental Cayce"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "860746843779381",
        pageName: "Todays Dental Cayce"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "1505658809"
    }
  },
  {
    clinicId: "creekcrossingdentalcare",
    odooCompanyId: 33,
    clinicAddress: "1927 FAITHON P LUCAS SR BLVD Ste 120 MESQUITE TX 75181-1698",
    clinicCity: "Mesquite",
    clinicEmail: "dentist@creekcrossingdentalcare.com",
    clinicFax: "469-333-6159",
    clinicName: "Creek Crossing Dental Care",
    clinicPhone: "469-333-6158",
    clinicState: "Texas",
    timezone: "America/Chicago",
    clinicZipCode: "75181",
    logoUrl: "https://creekcrossingdentalcare.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/k9Be93nCmmcaE3CG7",
    scheduleUrl: "https://creekcrossingdentalcare.com/patient-portal",
    websiteLink: "https://creekcrossingdentalcare.com",
    wwwUrl: "https://www.creekcrossingdentalcare.com",
    phoneNumber: "+14692250064",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/creekcrossingdentalcare.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-b10bbd82fce94f11968b03a4eec09322",
    sftpFolderPath: "creekcrossingdentalcare",
    hostedZoneId: "Z04673793CNYTEEDV0F48",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "creekcrossingdentalcare@gmail.com",
        fromEmail: "creekcrossingdentalcare@gmail.com",
        fromName: "Creek Crossing Dental Care"
      },
      domain: {
        imapHost: "mail.creekcrossingdentalcare.com",
        imapPort: 993,
        smtpHost: "mail.creekcrossingdentalcare.com",
        smtpPort: 465,
        smtpUser: "dentist@creekcrossingdentalcare.com",
        fromEmail: "dentist@creekcrossingdentalcare.com",
        fromName: "Creek Crossing Dental Care"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "802545442940105",
        pageName: "Creek Crossing Dental Care"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "6327290560"
    }
  },
  {
    clinicId: "dentistinwinston-salem",
    odooCompanyId: 35,
    clinicAddress: "3210 Silas Creek Pkwy, Suite-4 Winston salem, NC, 27103",
    clinicCity: "Winston-Salem",
    clinicEmail: "dentalcare@dentistinwinston-salem.com",
    clinicFax: "336-802-1898",
    clinicName: "Dentist in Winston-Salem",
    clinicPhone: "336-802-1894",
    clinicState: "North Carolina",
    timezone: "America/New_York",
    clinicZipCode: "27103",
    logoUrl: "https://dentistinwinston-salem.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/fAV5H59kFt1dfuMW9",
    scheduleUrl: "https://dentistinwinston-salem.com/patient-portal",
    websiteLink: "https://dentistinwinston-salem.com",
    wwwUrl: "https://www.dentistinwinston-salem.com",
    phoneNumber: "+13362836627",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinwinston-salem.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-3e55e6a9e1a14964b8876b8e35411049",
    sftpFolderPath: "dentistinwinston-salem",
    hostedZoneId: "Z0684688QGCIEZOQLTOQ",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinwinstonsalem@gmail.com",
        fromEmail: "dentistinwinstonsalem@gmail.com",
        fromName: "Dentist in Winston-Salem"
      },
      domain: {
        imapHost: "mail.dentistinwinston-salem.com",
        imapPort: 993,
        smtpHost: "mail.dentistinwinston-salem.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistinwinston-salem.com",
        fromEmail: "dentalcare@dentistinwinston-salem.com",
        fromName: "Dentist in Winston-Salem"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "798270746700728",
        pageName: "Dentist in Winston-Salem"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "8916450096"
    }
  },
  {
    clinicId: "dentistincentennial",
    odooCompanyId: 37,
    clinicAddress: "20269 E Smoky Hill Rd, Centennial, CO 80015, USA",
    clinicCity: "Centennial",
    clinicEmail: "dentalcare@dentistincentennial.com",
    clinicFax: "",
    clinicName: "Dentist in centennial",
    clinicPhone: "303-923-9068",
    clinicState: "Colorado",
    timezone: "America/Denver",
    clinicZipCode: "80015",
    logoUrl: "https://dentistincentennial.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/HjGoQovp8s1QbsC66",
    scheduleUrl: "https://dentistincentennial.com/patient-portal",
    websiteLink: "https://dentistincentennial.com",
    wwwUrl: "https://www.dentistincentennial.com",
    phoneNumber: "+17207020009",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistincentennial.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-e7812a96ba4049e288f04b702cd988b9",
    sftpFolderPath: "dentistincentennial",
    hostedZoneId: "Z01521441Y3EX4DY9YZAZ",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistincentennial@gmail.com",
        fromEmail: "dentistincentennial@gmail.com",
        fromName: "Dentist in centennial"
      },
      domain: {
        imapHost: "mail.dentistincentennial.com",
        imapPort: 993,
        smtpHost: "mail.dentistincentennial.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistincentennial.com",
        fromEmail: "dentalcare@dentistincentennial.com",
        fromName: "Dentist in centennial"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "804637432728253",
        pageName: "Dentist in centennial"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "8705012352"
    }
  },
  {
    clinicId: "renodentalcareandorthodontics",
    odooCompanyId: 38,
    clinicAddress: "8040 S VIRGINIA ST STE 4 RENO NV 89511-8939",
    clinicCity: "Reno",
    clinicEmail: "dentalcare@renodentalcareandorthodontics.com",
    clinicFax: "775-339-9894",
    clinicName: "Reno Dental Care and Orthodontics",
    clinicPhone: "775-339-9893",
    clinicState: "Nevada",
    timezone: "America/Los_Angeles",
    clinicZipCode: "89511",
    logoUrl: "https://renodentalcareandorthodontics.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/yqVa3N8mNwCgwBGv6",
    scheduleUrl: "https://renodentalcareandorthodontics.com/patient-portal",
    websiteLink: "https://renodentalcareandorthodontics.com",
    wwwUrl: "https://www.renodentalcareandorthodontics.com",
    phoneNumber: "+17752538664",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/renodentalcareandorthodontics.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-f097049ff6b947b59e73406acd056faf",
    sftpFolderPath: "renodentalcareandorthodontics",
    hostedZoneId: "Z06718466K032QAKNVB6",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinrenonv@gmail.com",
        fromEmail: "dentistinrenonv@gmail.com",
        fromName: "Reno Dental Care and Orthodontics"
      },
      domain: {
        imapHost: "mail.renodentalcareandorthodontics.com",
        imapPort: 993,
        smtpHost: "mail.renodentalcareandorthodontics.com",
        smtpPort: 465,
        smtpUser: "dentalcare@renodentalcareandorthodontics.com",
        fromEmail: "dentalcare@renodentalcareandorthodontics.com",
        fromName: "Reno Dental Care and Orthodontics"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "780646868466800",
        pageName: "Reno Dental Care and orthodontics"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "8844529656"
    }
  },
  {
    clinicId: "todaysdentalalexandria",
    odooCompanyId: 8,
    clinicAddress: "4601 Pinecrest Office Park Dr D, Alexandria, VA 22312, United States",
    clinicCity: "Alexandria",
    clinicEmail: "Dentist@TodaysDentalAlexandria.com",
    clinicFax: "(703) 256-5076",
    clinicName: "Todays Dental Alexandria",
    clinicPhone: "(703) 256-2085",
    clinicState: "Virginia",
    timezone: "America/New_York",
    clinicZipCode: "22312",
    logoUrl: "https://todaysdentalalexandria.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/vqABURPKCfMrFuuX9",
    scheduleUrl: "https://todaysdentalalexandria.com/patient-portal",
    websiteLink: "https://todaysdentalalexandria.com",
    wwwUrl: "https://www.todaysdentalalexandria.com",
    phoneNumber: "+17036728308",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentalalexandria.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-5206f38a54434048b08f43bfff0cf933",
    sftpFolderPath: "todaysdentalalexandria",
    hostedZoneId: "Z03912831F1RMPO1B73A1",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentalalexandria@gmail.com",
        fromEmail: "todaysdentalalexandria@gmail.com",
        fromName: "Todays Dental Alexandria"
      },
      domain: {
        imapHost: "mail.todaysdentalalexandria.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentalalexandria.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalAlexandria.com",
        fromEmail: "Dentist@TodaysDentalAlexandria.com",
        fromName: "Todays Dental Alexandria"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "854025807784463",
        pageName: "Todays Dental Alexandria"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "5285406194"
    }
  },
  {
    clinicId: "todaysdentalgreenville",
    odooCompanyId: 5,
    clinicAddress: "1530 Poinsett Hwy Greenville, SC 29609, USA",
    clinicCity: "Greenville",
    clinicEmail: "Dentist@TodaysDentalGreenville.com",
    clinicFax: "(864) 274-0708",
    clinicName: "Todays Dental Greenville",
    clinicPhone: "(864) 999-9899",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "29609",
    logoUrl: "https://todaysdentalgreenville.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/ksQRNsjQsjH7VNUa9",
    scheduleUrl: "https://todaysdentalgreenville.com/patient-portal",
    websiteLink: "https://todaysdentalgreenville.com",
    wwwUrl: "https://www.todaysdentalgreenville.com",
    phoneNumber: "+18643192662",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentalgreenville.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-fbad55ead7554aaaaaffa3400fe73a84",
    sftpFolderPath: "todaysdentalgreenville",
    hostedZoneId: "Z04077501PVREEA4QQROH",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentalgreenville@gmail.com",
        fromEmail: "todaysdentalgreenville@gmail.com",
        fromName: "Todays Dental Greenville"
      },
      domain: {
        imapHost: "mail.todaysdentalgreenville.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentalgreenville.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalGreenville.com",
        fromEmail: "Dentist@TodaysDentalGreenville.com",
        fromName: "Todays Dental Greenville"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "785393261324026",
        pageName: "Todays Dental Greenville"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "3865885156"
    }
  },
  {
    clinicId: "todaysdentalwestcolumbia",
    odooCompanyId: 6,
    clinicAddress: "115 Medical Cir West Columbia, SC 29169, USA",
    clinicCity: "West Columbia",
    clinicEmail: "Dentist@TodaysDentalWestColumbia.com",
    clinicFax: "(803) 233-8178",
    clinicName: "Todays Dental West Columbia",
    clinicPhone: "(803) 233-8177",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "29169",
    logoUrl: "https://todaysdentalwestcolumbia.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/NfpA3W9nsMdxC2gy5",
    scheduleUrl: "https://todaysdentalwestcolumbia.com/patient-portal",
    websiteLink: "https://todaysdentalwestcolumbia.com",
    wwwUrl: "https://www.todaysdentalwestcolumbia.com",
    phoneNumber: "+18032988480",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentalwestcolumbia.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-c6693db736964c09b670e9ba84735f2b",
    sftpFolderPath: "todaysdentalwestcolumbia",
    hostedZoneId: "Z04061862KUE9GXTYR3B8",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentalwestcolumbia@gmail.com",
        fromEmail: "todaysdentalwestcolumbia@gmail.com",
        fromName: "Todays Dental West Columbia"
      },
      domain: {
        imapHost: "mail.todaysdentalwestcolumbia.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentalwestcolumbia.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalWestColumbia.com",
        fromEmail: "Dentist@TodaysDentalWestColumbia.com",
        fromName: "Todays Dental West Columbia"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "780972621763947",
        pageName: "Todays Dental West Columbia"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "6830227762"
    }
  },
  {
    clinicId: "dentistinconcord",
    odooCompanyId: 20,
    clinicAddress: "2460 Wonder DR STE C, Kannapolis, NC 28083",
    clinicCity: "Concord",
    clinicEmail: "DentalCare@DentistinConcord.com",
    clinicFax: "(704) 707-3621",
    clinicName: "Dentist in Concord",
    clinicPhone: "(704) 707-3620",
    clinicState: "North Carolina",
    timezone: "America/New_York",
    clinicZipCode: "28083",
    logoUrl: "https://dentistinconcord.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/PRVNRH5U7tnv4erA8",
    scheduleUrl: "https://dentistinconcord.com/patient-portal",
    websiteLink: "https://dentistinconcord.com",
    wwwUrl: "https://www.dentistinconcord.com",
    phoneNumber: "+17043682506",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinconcord.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-d20c3c06affa4114a99d71b60eea87e4",
    sftpFolderPath: "dentistinconcord",
    hostedZoneId: "Z0424286J6ADTB4LRPD5",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinconcord@gmail.com",
        fromEmail: "dentistinconcord@gmail.com",
        fromName: "Dentist in Concord"
      },
      domain: {
        imapHost: "mail.dentistinconcord.com",
        imapPort: 993,
        smtpHost: "mail.dentistinconcord.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinConcord.com",
        fromEmail: "DentalCare@DentistinConcord.com",
        fromName: "Dentist in Concord"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "818707804648788",
        pageName: "Dentist in Concord"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "1771094795"
    }
  },
  {
    clinicId: "dentistinedgewater",
    odooCompanyId: 15,
    clinicAddress: "15 Lee Airpark Dr, Suite 100, Edgewater MD 21037",
    clinicCity: "Edgewater",
    clinicEmail: "DentalCare@DentistinEdgewater.com",
    clinicFax: "(443) 334-6689",
    clinicName: "Dentist in EdgeWater",
    clinicPhone: "(443) 334-6689",
    clinicState: "Maryland",
    timezone: "America/New_York",
    clinicZipCode: "21037",
    logoUrl: "https://dentistinedgewatermd.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/x97PmcG9KJH5Rdu16",
    scheduleUrl: "https://dentistinedgewatermd.com/patient-portal",
    websiteLink: "https://dentistinedgewatermd.com",
    wwwUrl: "https://www.dentistinedgewatermd.com",
    phoneNumber: "+14432038433",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinedgewatermd.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-476b26df530e42bcb55c157f20d5141e",
    sftpFolderPath: "dentistinedgewater",
    hostedZoneId: "Z0681492267AQBV6TNPKG",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinedgewatermd@gmail.com",
        fromEmail: "dentistinedgewatermd@gmail.com",
        fromName: "Dentist in EdgeWater"
      },
      domain: {
        imapHost: "mail.dentistinedgewater.com",
        imapPort: 993,
        smtpHost: "mail.dentistinedgewater.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinEdgewater.com",
        fromEmail: "DentalCare@DentistinEdgewater.com",
        fromName: "Dentist in EdgeWater"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "815231321665315",
        pageName: "Dentist in EdgeWater"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "6571919715"
    }
  },
  {
    clinicId: "lawrencevilledentistry",
    odooCompanyId: 11,
    clinicAddress: "1455 Pleasant Hill Road, Lawrenceville, Suite 807A, georgia 30044, USA",
    clinicCity: "Lawrenceville",
    clinicEmail: "Dentist@LawrencevilleDentistry.com",
    clinicFax: "(770) 415-4995",
    clinicName: "Lawrenceville Dentistry",
    clinicZipCode: "30044",
    clinicPhone: "(770)-415-0077",
    clinicState: "Georgia",
    timezone: "America/New_York",
    logoUrl: "https://lawrencevilledentistry.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/MFnMPmHSsdyHaGZe9",
    scheduleUrl: "https://lawrencevilledentistry.com/book-appointment",
    websiteLink: "https://lawrencevilledentistry.com",
    wwwUrl: "https://www.lawrencevilledentistry.com",
    phoneNumber: "+17702840555",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/lawrencevilledentistry.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-391fd647103a49c5ad36c38422ea8009",
    sftpFolderPath: "lawrencevilledentistry",
    hostedZoneId: "Z065164017R8THSISNPT8",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "lawrencevilledentistry@gmail.com",
        fromEmail: "lawrencevilledentistry@gmail.com",
        fromName: "Lawrenceville Dentistry"
      },
      domain: {
        imapHost: "mail.lawrencevilledentistry.com",
        imapPort: 993,
        smtpHost: "mail.lawrencevilledentistry.com",
        smtpPort: 465,
        smtpUser: "Dentist@LawrencevilleDentistry.com",
        fromEmail: "Dentist@LawrencevilleDentistry.com",
        fromName: "Lawrenceville Dentistry"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "764215823445811",
        pageName: "Lawrenceville Dentistry"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9954954552"
    }
  },
  {
    clinicId: "dentistinlouisville",
    odooCompanyId: 21,
    clinicAddress: "6826 Bardstown Road, Louisville Kentucky 40291, USA",
    clinicCity: "Louisville",
    clinicEmail: "dentalcare@dentistinlouisville.com",
    clinicFax: "(502) 212-9629",
    clinicName: "Dentist In Louisville",
    clinicZipCode: "40291",
    clinicPhone: "(502)-239-9751",
    clinicState: "Kentucky",
    timezone: "America/New_York",
    logoUrl: "https://dentistinlouisville.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/m76QtysK96poeUWy7",
    scheduleUrl: "https://dentistinlouisville.com/book-appointment",
    websiteLink: "https://dentistinlouisville.com",
    wwwUrl: "https://www.dentistinlouisville.com",
    phoneNumber: "+15022158254",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinlouisville.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-a2fe2c95e0254b12a39e7fe1d4359223",
    sftpFolderPath: "dentistinlouisville",
    hostedZoneId: "Z01681663I51Z0MKKI4RU",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinlouisvillekentucky@gmail.com",
        fromEmail: "dentistinlouisvillekentucky@gmail.com",
        fromName: "Dentist In Louisville"
      },
      domain: {
        imapHost: "mail.dentistinlouisville.com",
        imapPort: 993,
        smtpHost: "mail.dentistinlouisville.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistinlouisville.com",
        fromEmail: "dentalcare@dentistinlouisville.com",
        fromName: "Dentist In Louisville"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "830585603464796",
        pageName: "Dentist In Louisville"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9277361743"
    }
  },
  {
    clinicId: "dentistatsaludapointe",
    odooCompanyId: 7,
    clinicAddress: "105 Saluda Pointe Ct Suite C, Lexington, SC 29072, USA",
    clinicCity: "SaludaPointe",
    clinicEmail: "DentalCare@DentistatSaludaPointe.com",
    clinicFax: "",
    clinicName: "Todays Dental Saluda Pointe",
    clinicZipCode: "29072",
    clinicPhone: "(803) 399-8236",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    logoUrl: "https://dentistatsaludapointe.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/ybcArAkBw4JLHqmY7",
    scheduleUrl: "https://dentistatsaludapointe.com/book-appointment",
    websiteLink: "https://dentistatsaludapointe.com",
    wwwUrl: "https://www.dentistatsaludapointe.com",
    phoneNumber: "+18032919970",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistatsaludapointe.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-a7079480e46c41308fdcf855a79a6555",
    sftpFolderPath: "dentistatsaludapointe",
    hostedZoneId: "Z065149151EMKCBPQEVL",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistatsaludapointe@gmail.com",
        fromEmail: "dentistatsaludapointe@gmail.com",
        fromName: "Todays Dental Saluda Pointe"
      },
      domain: {
        imapHost: "mail.dentistatsaludapointe.com",
        imapPort: 993,
        smtpHost: "mail.dentistatsaludapointe.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistatSaludaPointe.com",
        fromEmail: "DentalCare@DentistatSaludaPointe.com",
        fromName: "Todays Dental Saluda Pointe"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "830923773419024",
        pageName: "Dentist At Saluda Pointe"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9490955129"
    }
  },
  {
    clinicId: "dentistinoregonoh",
    odooCompanyId: 25,
    clinicAddress: "3555 Navarre Ave Stre 12, Oregon OH 43616",
    clinicCity: "Oregon",
    clinicEmail: "dentalcare@dentistinoregonoh.com",
    clinicFax: "(419) 391-9906",
    clinicName: "Dentist in Oregon",
    clinicPhone: "(419) 690-0320",
    clinicState: "Ohio",
    timezone: "America/New_York",
    clinicZipCode: "43616",
    logoUrl: "https://dentistinoregonoh.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/dHUuSUYSeot1YxBw5",
    scheduleUrl: "https://dentistinOregonoh.com/patient-portal",
    websiteLink: "https://dentistinoregonoh.com",
    wwwUrl: "https://www.dentistinoregonoh.com",
    phoneNumber: "+14193183371",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinoregonoh.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-9039b266b7024aed8a45f3747c511a34",
    sftpFolderPath: "dentistinoregonoh",
    hostedZoneId: "Z0424621RYEA9FEBS0JY",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinoregonoh@gmail.com",
        fromEmail: "dentistinoregonoh@gmail.com",
        fromName: "Dentist in Oregon"
      },
      domain: {
        imapHost: "mail.dentistinoregonoh.com",
        imapPort: 993,
        smtpHost: "mail.dentistinoregonoh.com",
        smtpPort: 465,
        smtpUser: "dentalcare@dentistinoregonoh.com",
        fromEmail: "dentalcare@dentistinoregonoh.com",
        fromName: "Dentist in Oregon"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "761336133733464",
        pageName: "Dentist in Oregon"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "2121863652"
    }
  },
  {
    clinicId: "todaysdentallexington",
    odooCompanyId: 2,
    clinicAddress: "458 Old Cherokee Rd Suite 100, Lexington, SC 29072, USA",
    clinicCity: "Lexington",
    clinicEmail: "Dentist@TodaysDentalLexington.com",
    clinicFax: "",
    clinicName: "Todays Dental Lexington",
    clinicPhone: "(803) 756-4353",
    clinicState: "South Carolina",
    timezone: "America/New_York",
    clinicZipCode: "43616",
    logoUrl: "https://todaysdentallexington.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/nBnxjeHrWU8mxDgV7",
    scheduleUrl: "https://todaysdentallexington.com/patient-portal",
    websiteLink: "https://todaysdentallexington.com",
    wwwUrl: "https://www.todaysdentallexington.com",
    phoneNumber: "+18032210987",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/todaysdentallexington.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-5d5c8099c6624552a7d779037d702f4b",
    sftpFolderPath: "daysdentallexington",
    hostedZoneId: "Z040331235NMZIX4ZLLGE",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "todaysdentallexington@gmail.com",
        fromEmail: "todaysdentallexington@gmail.com",
        fromName: "Todays Dental Lexington"
      },
      domain: {
        imapHost: "mail.todaysdentallexington.com",
        imapPort: 993,
        smtpHost: "mail.todaysdentallexington.com",
        smtpPort: 465,
        smtpUser: "Dentist@TodaysDentalLexington.com",
        fromEmail: "Dentist@TodaysDentalLexington.com",
        fromName: "Todays Dental Lexington"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "739288799274944",
        pageName: "Todays Dental Lexington"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9085359447"
    }
  },
  {
    clinicId: "dentistinbowie",
    odooCompanyId: 9,
    clinicAddress: "14999 Health Center Dr #110 Bowie, MD 20716, USA",
    clinicCity: "Bowie",
    clinicEmail: "DentalCare@DentistinBowie.com",
    clinicFax: "(301) 880-0940",
    clinicName: "Dentist in Bowie",
    clinicZipCode: "20716",
    clinicPhone: "(301) 880-0504",
    clinicState: "Maryland",
    timezone: "America/New_York",
    logoUrl: "https://dentistinbowie.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/Tb2ZSscmYFCkdEsLA",
    scheduleUrl: "https://dentistinbowie.com/patient-portal",
    websiteLink: "https://dentistinbowie.com",
    wwwUrl: "https://www.dentistinbowie.com",
    phoneNumber: "+13012416572",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinbowie.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-23cbc8f035e94d7c85a8177361999c75",
    sftpFolderPath: "dentistinbowie",
    hostedZoneId: "Z06428572342W1A3EK5HA",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinbowie@gmail.com",
        fromEmail: "dentistinbowie@gmail.com",
        fromName: "Dentist in Bowie"
      },
      domain: {
        imapHost: "mail.dentistinbowie.com",
        imapPort: 993,
        smtpHost: "mail.dentistinbowie.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinBowie.com",
        fromEmail: "DentalCare@DentistinBowie.com",
        fromName: "Dentist in Bowie"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "786812141180019",
        pageName: "Dentist in Bowie"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "4551655949"
    }
  },
  {
    clinicId: "dentistinpowellohio",
    odooCompanyId: 16,
    clinicAddress: "4091 W Powell Rd#1, Powell, OH 43065",
    clinicCity: "Powell",
    clinicEmail: "DentalCare@DentistinPowellOhio.com",
    clinicFax: "(614) 664-9667",
    clinicName: "Dentist in Powell",
    clinicZipCode: "43065",
    clinicPhone: "(614) 659-0018",
    clinicState: "Ohio",
    timezone: "America/New_York",
    logoUrl: "https://dentistinpowellohio.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/eR4MznoQ3gj897NX8",
    scheduleUrl: "https://dentistinpowellohio.com/patient-portal",
    websiteLink: "https://dentistinpowellohio.com",
    wwwUrl: "https://www.dentistinpowellohio.com",
    phoneNumber: "+16144898815",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinpowellohio.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-0a580af9da914a03bb68a715a212848f",
    sftpFolderPath: "dentistinpowellohio",
    hostedZoneId: "Z06449472H2KB1S9FS2K5",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinpowellohio@gmail.com",
        fromEmail: "dentistinpowellohio@gmail.com",
        fromName: "Dentist in Powell"
      },
      domain: {
        imapHost: "mail.dentistinpowellohio.com",
        imapPort: 993,
        smtpHost: "mail.dentistinpowellohio.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinPowellOhio.com",
        fromEmail: "DentalCare@DentistinPowellOhio.com",
        fromName: "Dentist in Powell"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "779484698582071",
        pageName: "Dentist in Powell"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "4638071933"
    }
  },
  {
    clinicId: "dentistinperrysburg",
    odooCompanyId: 10,
    clinicAddress: "110 E South Boundary St, Perrysburg, OH 43551, USA",
    clinicCity: "Perrysburg",
    clinicEmail: "Dentalcare@dentistinperrysburg.com",
    clinicFax: "(419) 792-1263",
    clinicName: "Dentist in PerrysBurg",
    clinicZipCode: "43551",
    clinicPhone: "(419) 792-1264",
    clinicState: "Ohio",
    timezone: "America/New_York",
    logoUrl: "https://dentistinperrysburg.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/aVCiTAY9UvGYXQaR8",
    scheduleUrl: "https://dentistinperrysburg.com/patient-portal",
    websiteLink: "https://dentistinperrysburg.com",
    wwwUrl: "https://www.dentistinperrysburg.com",
    phoneNumber: "+14193183386",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinperrysburg.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-819f553d8d72424a85292eab0e0030ce",
    sftpFolderPath: "dentistinperrysburg",
    hostedZoneId: "Z0190676238ABL9C3TV32",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinperrysburg@gmail.com",
        fromEmail: "dentistinperrysburg@gmail.com",
        fromName: "Dentist in PerrysBurg"
      },
      domain: {
        imapHost: "mail.dentistinperrysburg.com",
        imapPort: 993,
        smtpHost: "mail.dentistinperrysburg.com",
        smtpPort: 465,
        smtpUser: "Dentalcare@dentistinperrysburg.com",
        fromEmail: "Dentalcare@dentistinperrysburg.com",
        fromName: "Dentist in PerrysBurg"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "743300888873794",
        pageName: "Dentist in PerrysBurg"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "7421865491"
    }
  },
  {
    clinicId: "dentistinaustin",
    odooCompanyId: 34,
    clinicAddress: "2110 W Slaughter Ln Ste 190 Austin, TX 78748",
    clinicCity: "Austin",
    clinicEmail: "Dentalcare@dentistinaustintx.com",
    clinicFax: "(512) 430-4563",
    clinicName: "Dentist in Austin",
    clinicZipCode: "78748",
    clinicPhone: "512-430-4472",
    clinicState: "Texas",
    timezone: "America/Chicago",
    logoUrl: "https://dentistinaustintx.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/BbvkUzQb14p6YhH77",
    scheduleUrl: "https://dentistinaustintx.com/patient-portal",
    websiteLink: "https://dentistinaustintx.com",
    wwwUrl: "https://www.dentistinaustintx.com",
    phoneNumber: "+15123095624",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinaustintx.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-dd34e09bf3c648848318c031cfeb13b6",
    sftpFolderPath: "dentistinaustin",
    hostedZoneId: "Z039585419DY53TZXW8SA",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinaustin@gmail.com",
        fromEmail: "dentistinaustin@gmail.com",
        fromName: "Dentist in Austin"
      },
      domain: {
        imapHost: "mail.dentistinaustintx.com",
        imapPort: 993,
        smtpHost: "mail.dentistinaustintx.com",
        smtpPort: 465,
        smtpUser: "Dentalcare@dentistinaustintx.com",
        fromEmail: "Dentalcare@dentistinaustintx.com",
        fromName: "Dentist in Austin"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "787337507798286",
        pageName: "Dentist in Austin"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "5770542490"
    }
  },
  {
    clinicId: "therimdentalcare",
    odooCompanyId: 29,
    clinicAddress: "6028 WORTH PKWY STE 101, SAN ANTONIO, TX 78257-5071",
    clinicCity: "SAN ANTONIO",
    clinicEmail: "Dentist@therimdentalcare.com",
    clinicFax: "(726) 215-9920",
    clinicName: "The Rim Dental Care",
    clinicPhone: "(726) 215-9920",
    clinicState: "Texas",
    timezone: "America/Chicago",
    clinicZipCode: "78257-5071",
    logoUrl: "https://therimdentalcare.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/cabosKW6nqkmPCQs8",
    scheduleUrl: "https://therimdentalcare.com/patient-portal",
    websiteLink: "https://therimdentalcare.com",
    wwwUrl: "https://www.therimdentalcare.com",
    phoneNumber: "+17262023123",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/therimdentalcare.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-698ca15acec542ba849576b9440ca958",
    sftpFolderPath: "therimdentalcare",
    hostedZoneId: "Z062554333J0IQ9RHN2OP",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "therimdentalcare@gmail.com",
        fromEmail: "therimdentalcare@gmail.com",
        fromName: "The Rim Dental Care"
      },
      domain: {
        imapHost: "mail.therimdentalcare.com",
        imapPort: 993,
        smtpHost: "mail.therimdentalcare.com",
        smtpPort: 465,
        smtpUser: "Dentist@therimdentalcare.com",
        fromEmail: "Dentist@therimdentalcare.com",
        fromName: "The Rim Dental Care"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "737273779478519",
        pageName: "The Rim Dental Care"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "5001733364"
    }
  },
  {
    clinicId: "dentistinbloomingdale",
    odooCompanyId: 27,
    clinicAddress: "366 W Army Trail Rd #310a, Bloomingdale, IL 60108, USA",
    clinicCity: "Bloomingdale",
    clinicEmail: "Dentalcare@dentistinbloomingdaleil.com",
    clinicFax: "(630) 686-1327",
    clinicName: "Dentist in Bloomingdale",
    clinicZipCode: "60108",
    clinicPhone: "(630) 686-1328",
    clinicState: "Illinois",
    timezone: "America/Chicago",
    logoUrl: "https://dentistinbloomingdaleil.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/e7WeCV2FKXuTbyMA6",
    scheduleUrl: "https://dentistinbloomingdaleil.com/patient-portal",
    websiteLink: "https://dentistinbloomingdaleil.com",
    wwwUrl: "https://www.dentistinbloomingdaleil.com",
    phoneNumber: "+16302969003",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinbloomingdaleil.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-b818b4b13ed846529fc08e5a27935ef7",
    sftpFolderPath: "dentistinbloomingdale",
    hostedZoneId: "Z0168184178UA6OJU34E4",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinbloomingdale@gmail.com",
        fromEmail: "dentistinbloomingdale@gmail.com",
        fromName: "Dentist in Bloomingdale"
      },
      domain: {
        imapHost: "mail.dentistinbloomingdaleil.com",
        imapPort: 993,
        smtpHost: "mail.dentistinbloomingdaleil.com",
        smtpPort: 465,
        smtpUser: "Dentalcare@dentistinbloomingdaleil.com",
        fromEmail: "Dentalcare@dentistinbloomingdaleil.com",
        fromName: "Dentist in Bloomingdale"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "795753343619807",
        pageName: "Dentist in Bloomingdale"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "5553837131"
    }
  },
  {
    clinicId: "dentistinvernonhills",
    odooCompanyId: 32,
    clinicAddress: "6826 Bardstown Road, VernonHills, Illinois, 40291, USA",
    clinicCity: "VernonHills",
    clinicEmail: "DentalCare@DentistinVernonHills.com",
    clinicFax: "",
    clinicName: "Dentist in Vernon Hills",
    clinicZipCode: "40291",
    clinicPhone: "(847) 978-4077",
    clinicState: "Illinois",
    timezone: "America/Chicago",
    logoUrl: "https://dentistinvernonhills.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/3EJBccxEGW41P8Rh7",
    scheduleUrl: "https://dentistinvernonhills.com/patient-portal",
    websiteLink: "https://dentistinvernonhills.com",
    wwwUrl: "https://www.dentistinvernonhills.com",
    phoneNumber: "+18472608875",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/dentistinvernonhills.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-3e30fb6357124b5cb03bfadfc72859ba",
    sftpFolderPath: "dentistinvernonhills",
    hostedZoneId: "Z01676602Q7T5NJOJ0NZU",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinvernonhills@gmail.com",
        fromEmail: "dentistinvernonhills@gmail.com",
        fromName: "Dentist in Vernon Hills"
      },
      domain: {
        imapHost: "mail.dentistinvernonhills.com",
        imapPort: 993,
        smtpHost: "mail.dentistinvernonhills.com",
        smtpPort: 465,
        smtpUser: "DentalCare@DentistinVernonHills.com",
        fromEmail: "DentalCare@DentistinVernonHills.com",
        fromName: "Dentist in Vernon Hills"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "817804011415991",
        pageName: "Dentist in Vernon Hills"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "4656582027"
    }
  },
  {
    clinicId: "meadowsdentalcare",
    odooCompanyId: 36,
    clinicAddress: "9600 S I-35 Frontage Rd Bldg S #275, Austin, TX 78748, United States",
    clinicCity: "Austin",
    clinicEmail: "dentist@themeadowsdentalcare.com",
    clinicFax: "(737) 263-1592",
    clinicName: "Meadows Dental Care",
    clinicZipCode: "78748",
    clinicPhone: "(737) 263-1581",
    clinicState: "Texas",
    timezone: "America/Chicago",
    logoUrl: "https://themeadowsdentalcare.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/Hz4S86nieDoEJyZi6",
    scheduleUrl: "https://themeadowsdentalcare.com/patient-portal",
    websiteLink: "https://themeadowsdentalcare.com",
    wwwUrl: "https://www.themeadowsdentalcare.com",
    phoneNumber: "+17372273831",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/themeadowsdentalcare.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-d6087aec7474416a81b800eec92bf33a",
    sftpFolderPath: "meadowsdentalcare",
    hostedZoneId: "Z0228748YTYJQTBTCWH1",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "meadowsdentalcare@gmail.com",
        fromEmail: "meadowsdentalcare@gmail.com",
        fromName: "Meadows Dental Care"
      },
      domain: {
        imapHost: "mail.themeadowsdentalcare.com",
        imapPort: 993,
        smtpHost: "mail.themeadowsdentalcare.com",
        smtpPort: 465,
        smtpUser: "dentist@themeadowsdentalcare.com",
        fromEmail: "dentist@themeadowsdentalcare.com",
        fromName: "Meadows Dental Care"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "761234307081671",
        pageName: "Meadows Dental Care"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "7115897921"
    }
  },
  {
    clinicId: "dentistinstillwater",
    odooCompanyId: 39,
    clinicAddress: "5619 W. Loop, 1604 N Ste 112, San Antonio, TX 78253-5795",
    clinicCity: "San Antonio",
    clinicEmail: "dentalcare@stillwaterdentalcareandortho.com",
    clinicFax: "",
    clinicName: "Dentist in Still Water",
    clinicZipCode: "78253-5795",
    clinicPhone: "254-492-3224",
    clinicState: "Texas",
    timezone: "America/Chicago",
    logoUrl: "https://stillwaterdentalcareandortho.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/Gc14g4dakEXrwbTi7",
    scheduleUrl: "https://stillwaterdentalcareandortho.com/patient-portal",
    websiteLink: "https://stillwaterdentalcareandortho.com",
    wwwUrl: "https://www.stillwaterdentalcareandortho.com",
    phoneNumber: "+12542250133",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/stillwaterdentalcareandortho.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-b34686d575d34041a7dcd5fac6db3369",
    sftpFolderPath: "dentistinstillwater",
    hostedZoneId: "Z029178313VFV0GYWY3NS",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "dentistinstillwater@gmail.com",
        fromEmail: "dentistinstillwater@gmail.com",
        fromName: "Dentist in Still Water"
      },
      domain: {
        imapHost: "mail.stillwaterdentalcareandortho.com",
        imapPort: 993,
        smtpHost: "mail.stillwaterdentalcareandortho.com",
        smtpPort: 465,
        smtpUser: "dentalcare@stillwaterdentalcareandortho.com",
        fromEmail: "dentalcare@stillwaterdentalcareandortho.com",
        fromName: "Dentist in Still Water"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "717972378076257",
        pageName: "Dentist in Still Water"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "9116392960"
    }
  },
  {
    clinicId: "pearlanddentalcare",
    odooCompanyId: 40,
    clinicAddress: "1921 N Main St Ste 115, Pearland TX 77581",
    clinicCity: "Pearland",
    clinicEmail: "dentalcare@pearlanddentalcare.com",
    clinicFax: "",
    clinicName: "Pearland Dental Care",
    clinicZipCode: "77581",
    clinicPhone: "832-955-1682",
    clinicState: "Texas",
    timezone: "America/Chicago",
    logoUrl: "https://pearlanddentalcare.com/logo.png",
    mapsUrl: "https://maps.app.goo.gl/9ZFsgFAnRKyJmj5s6",
    scheduleUrl: "https://pearlanddentalcare.com/patient-portal",
    websiteLink: "https://pearlanddentalcare.com",
    wwwUrl: "https://www.pearlanddentalcare.com",
    phoneNumber: "+18322806867",
    aiPhoneNumber: "",
    sesIdentityArn: "arn:aws:ses:us-east-1:851620242036:identity/pearlanddentalcare.com",
    smsOriginationArn: "arn:aws:sms-voice:us-east-1:851620242036:phone-number/phone-e6bc4666724a4e20bdff15017b2c165e",
    sftpFolderPath: "pearlanddentalcare",
    hostedZoneId: "Z02753391M42GQCRXDDCE",
    email: {
      gmail: {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpUser: "pearlanddentalcare@gmail.com",
        fromEmail: "pearlanddentalcare@gmail.com",
        fromName: "Pearland Dental Care"
      },
      domain: {
        imapHost: "mail.pearlanddentalcare.com",
        imapPort: 993,
        smtpHost: "mail.pearlanddentalcare.com",
        smtpPort: 465,
        smtpUser: "dentalcare@pearlanddentalcare.com",
        fromEmail: "dentalcare@pearlanddentalcare.com",
        fromName: "Pearland Dental Care"
      }
    },
    ayrshare: {
      enabled: true,
      connectedPlatforms: ["facebook"],
      facebook: {
        connected: true,
        pageId: "764480776752152",
        pageName: "Pearland Dental Care"
      }
    },
    googleAds: {
      enabled: true,
      customerId: "8278105993"
    }
  }
];

// src/services/secrets/seeder.ts
var dynamodb = new DynamoDBClient({});
var CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE;
var GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE;
var CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE;
async function batchWriteItems(tableName, items) {
  const BATCH_SIZE = 25;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const writeRequests = batch.map((item) => ({
      PutRequest: {
        Item: marshall(item, { removeUndefinedValues: true })
      }
    }));
    const params = {
      RequestItems: {
        [tableName]: writeRequests
      }
    };
    try {
      await dynamodb.send(new BatchWriteItemCommand(params));
      console.log(`[Seeder] Successfully wrote ${batch.length} items to ${tableName} (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
    } catch (error) {
      console.error(`[Seeder] Error writing batch to ${tableName}:`, error);
      throw error;
    }
  }
}
async function seedClinicSecrets() {
  console.log(`[Seeder] Seeding ${clinic_secrets_default.length} clinic secrets...`);
  const items = clinic_secrets_default.map((secret) => ({
    clinicId: secret.clinicId,
    openDentalDeveloperKey: secret.openDentalDeveloperKey,
    openDentalCustomerKey: secret.openDentalCustomerKey,
    authorizeNetApiLoginId: secret.authorizeNetApiLoginId,
    authorizeNetTransactionKey: secret.authorizeNetTransactionKey,
    gmailSmtpPassword: secret.gmailSmtpPassword,
    domainSmtpPassword: secret.domainSmtpPassword,
    ayrshareProfileKey: secret.ayrshareProfileKey,
    ayrshareRefId: secret.ayrshareRefId,
    // RCS messaging configuration
    rcsSenderId: secret.rcsSenderId,
    messagingServiceSid: secret.messagingServiceSid,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }));
  await batchWriteItems(CLINIC_SECRETS_TABLE, items);
  return items.length;
}
async function seedGlobalSecrets() {
  console.log(`[Seeder] Seeding ${global_secrets_default.length} global secrets...`);
  const items = global_secrets_default.map((secret) => ({
    secretId: secret.secretId,
    secretType: secret.secretType,
    value: secret.value,
    metadata: secret.metadata || {},
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }));
  await batchWriteItems(GLOBAL_SECRETS_TABLE, items);
  return items.length;
}
async function seedClinicConfig() {
  console.log(`[Seeder] Seeding ${clinic_config_default.length} clinic configs...`);
  const items = clinic_config_default.map((config) => ({
    ...config,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }));
  await batchWriteItems(CLINIC_CONFIG_TABLE, items);
  return items.length;
}
async function handler(event) {
  console.log("[Seeder] Received event:", JSON.stringify(event, null, 2));
  const requestType = event.RequestType;
  const physicalResourceId = event.PhysicalResourceId || `secrets-seeder-${Date.now()}`;
  try {
    if (requestType === "Create" || requestType === "Update") {
      console.log(`[Seeder] Processing ${requestType} request...`);
      const clinicSecretsCount = await seedClinicSecrets();
      const globalSecretsCount = await seedGlobalSecrets();
      const clinicConfigCount = await seedClinicConfig();
      console.log("[Seeder] Seeding completed successfully!");
      console.log(`[Seeder] Summary: ${clinicSecretsCount} clinic secrets, ${globalSecretsCount} global secrets, ${clinicConfigCount} clinic configs`);
      return {
        Status: "SUCCESS",
        PhysicalResourceId: physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: {
          Message: "Secrets seeding completed successfully",
          ClinicSecretsCount: clinicSecretsCount.toString(),
          GlobalSecretsCount: globalSecretsCount.toString(),
          ClinicConfigCount: clinicConfigCount.toString()
        }
      };
    } else if (requestType === "Delete") {
      console.log("[Seeder] Delete request received - data will be retained in tables");
      return {
        Status: "SUCCESS",
        PhysicalResourceId: physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: {
          Message: "Delete acknowledged - data retained in tables"
        }
      };
    }
    const anyEvent = event;
    return {
      Status: "FAILED",
      PhysicalResourceId: physicalResourceId,
      StackId: anyEvent.StackId,
      RequestId: anyEvent.RequestId,
      LogicalResourceId: anyEvent.LogicalResourceId,
      Reason: `Unknown request type: ${requestType}`
    };
  } catch (error) {
    console.error("[Seeder] Error processing request:", error);
    const anyEvent = event;
    return {
      Status: "FAILED",
      PhysicalResourceId: physicalResourceId,
      StackId: anyEvent.StackId,
      RequestId: anyEvent.RequestId,
      LogicalResourceId: anyEvent.LogicalResourceId,
      Reason: error instanceof Error ? error.message : "Unknown error occurred"
    };
  }
}
export {
  handler
};
