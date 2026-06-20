export type SwedishAirport = {
  icao: string | null
  name: string | null
  lat: number
  lon: number
  category: string | null
  detailsInAd2: boolean
  runways: Array<{
    designator: string
    dimensionsMeters: string | null
    surface: string | null
  }>
}

export const swedishAirports: SwedishAirport[] = [
  {
    "icao": "ESGI",
    "name": "ALINGSÅS",
    "lat": 57.94972222222222,
    "lon": 12.578055555555554,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "600 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESMP",
    "name": "ANDERSTORP",
    "lat": 57.265,
    "lon": 13.601666666666667,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "04/22",
        "dimensionsMeters": "1000 x 20",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESQO",
    "name": "ARBOGA",
    "lat": 59.388333333333335,
    "lon": 15.920833333333333,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "15/33",
        "dimensionsMeters": "1700 x 40",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESUB",
    "name": "ARBRÅ",
    "lat": 61.5125,
    "lon": 16.3725,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "18/36",
        "dimensionsMeters": "700 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESNX",
    "name": "ARVIDSJAUR",
    "lat": 65.59027777777777,
    "lon": 19.281944444444445,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "2500 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESKV",
    "name": "ARVIKA",
    "lat": 59.675,
    "lon": 12.639444444444443,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "1150 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESVA",
    "name": "AVESTA",
    "lat": 60.180277777777775,
    "lon": 16.122777777777777,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "15/33",
        "dimensionsMeters": "850 x 40",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESMB",
    "name": "BORGLANDA",
    "lat": 56.863055555555555,
    "lon": 16.65611111111111,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "625 x 50",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESSD",
    "name": "BORLÄNGE",
    "lat": 60.42222222222222,
    "lon": 15.515,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "14/32",
        "dimensionsMeters": "2313 x 45",
        "surface": "ASPH"
      },
      {
        "designator": "12/30",
        "dimensionsMeters": "720 x 40",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESGE",
    "name": "BORÅS",
    "lat": 57.69583333333333,
    "lon": 12.845,
    "category": "Licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "04L/22R",
        "dimensionsMeters": "800 x 18",
        "surface": "ASPH"
      },
      {
        "designator": "04R/22L",
        "dimensionsMeters": "800 x 50",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESSM",
    "name": "BRATTFORSHEDEN",
    "lat": 59.608333333333334,
    "lon": 13.912222222222223,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "08/26",
        "dimensionsMeters": "800 x 50",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESVB",
    "name": "BUNGE",
    "lat": 57.85,
    "lon": 19.038333333333334,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "09/27",
        "dimensionsMeters": "675 x 30",
        "surface": "ASPH"
      },
      {
        "designator": "16/34",
        "dimensionsMeters": "675 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESKD",
    "name": "DALA-JÄRNA",
    "lat": 60.55611111111111,
    "lon": 14.377222222222223,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "900 x 24",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESUY",
    "name": "EDSBYN",
    "lat": 61.386944444444445,
    "lon": 15.833333333333334,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "11/29",
        "dimensionsMeters": "700 x 40",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESKH",
    "name": "EKSHÄRAD",
    "lat": 60.15472222222222,
    "lon": 13.528611111111111,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "15/33",
        "dimensionsMeters": "540 x 45",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESMC",
    "name": "EKSJÖ/RÄNNESLÄTT",
    "lat": 57.669999999999995,
    "lon": 14.941944444444445,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "1000 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESVL",
    "name": "ENKÖPING/LÅNGTORA",
    "lat": 59.74722222222222,
    "lon": 17.145,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "720 x 200",
        "surface": "GRASS"
      },
      {
        "designator": "07/25",
        "dimensionsMeters": "670 x 200",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESSU",
    "name": "ESKILSTUNA",
    "lat": 59.352222222222224,
    "lon": 16.708333333333332,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "18/36",
        "dimensionsMeters": "1886 x 35",
        "surface": "CONC/ASPH"
      }
    ]
  },
  {
    "icao": "ESSC",
    "name": "ESKILSTUNA/EKEBY",
    "lat": 59.38388888888889,
    "lon": 16.441944444444445,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "05/23",
        "dimensionsMeters": "850 x 150",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESME",
    "name": "ESLÖV",
    "lat": 55.848333333333336,
    "lon": 13.331111111111111,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "799 x 20",
        "surface": "ASPH"
      },
      {
        "designator": "06/24",
        "dimensionsMeters": "450 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESMF",
    "name": "FAGERHULT",
    "lat": 56.38777777777778,
    "lon": 13.470555555555556,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "17/35",
        "dimensionsMeters": "590 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESGF",
    "name": "FALKENBERG/MORUP",
    "lat": 56.968611111111116,
    "lon": 12.387222222222222,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "09/27",
        "dimensionsMeters": "700 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESGK",
    "name": "FALKÖPING",
    "lat": 58.169999999999995,
    "lon": 13.587777777777779,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "04/22",
        "dimensionsMeters": "1316 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESTF",
    "name": "FJÄLLBACKA",
    "lat": 58.63027777777778,
    "lon": 11.315000000000001,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "06/24",
        "dimensionsMeters": "740 x 34",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESVG",
    "name": "GAGNEF",
    "lat": 60.55083333333333,
    "lon": 15.078055555555554,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "08/26",
        "dimensionsMeters": "600 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESUG",
    "name": "GARGNÄS",
    "lat": 65.30527777777777,
    "lon": 17.975555555555555,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "17/35",
        "dimensionsMeters": "940 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESSZ",
    "name": "GNESTA/VÄNGSÖ",
    "lat": 59.10111111111111,
    "lon": 17.211111111111112,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "770 x 30",
        "surface": "GRASS"
      },
      {
        "designator": "15/33",
        "dimensionsMeters": "700 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESKG",
    "name": "GRYTTJOM",
    "lat": 60.28611111111111,
    "lon": 17.429444444444446,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "17/35",
        "dimensionsMeters": "809 x 27",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESNG",
    "name": "GÄLLIVARE",
    "lat": 67.13305555555554,
    "lon": 20.81222222222222,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "1714 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESSK",
    "name": "GÄVLE",
    "lat": 60.593333333333334,
    "lon": 16.95138888888889,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "18/36",
        "dimensionsMeters": "2000 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGG",
    "name": "GÖTEBORG/LANDVETTER",
    "lat": 57.66,
    "lon": 12.29111111111111,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "3299 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGT",
    "name": "GÖTEBORG/STALLBACKA",
    "lat": 58.31805555555556,
    "lon": 12.345,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "15/33",
        "dimensionsMeters": "1710 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGP",
    "name": "GÖTEBORG/SÄVE",
    "lat": 57.775555555555556,
    "lon": 11.870555555555557,
    "category": "Licensed AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "1085 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGN",
    "name": "GÖTENE/BRÄNNEBRONA",
    "lat": 58.578611111111115,
    "lon": 13.610555555555555,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "600 x 40",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESOH",
    "name": "HAGFORS",
    "lat": 60.02111111111111,
    "lon": 13.578888888888889,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "18/36",
        "dimensionsMeters": "1508 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESMV",
    "name": "HAGSHULT",
    "lat": 57.29222222222222,
    "lon": 14.136944444444444,
    "category": "MIL, non-licensed AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "04/22",
        "dimensionsMeters": "2020 x 40",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESNA",
    "name": "HALLVIKEN",
    "lat": 63.73833333333334,
    "lon": 15.458888888888888,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "14/32",
        "dimensionsMeters": "800 x 15",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESMT",
    "name": "HALMSTAD",
    "lat": 56.69083333333333,
    "lon": 12.82,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "2268 x 45",
        "surface": "ASPH"
      },
      {
        "designator": "06/24",
        "dimensionsMeters": "609 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESNC",
    "name": "HEDE/HEDLANDA",
    "lat": 62.40888888888889,
    "lon": 13.747222222222222,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "06/24",
        "dimensionsMeters": "1175 x 33",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESUT",
    "name": "HEMAVAN TÄRNABY",
    "lat": 65.80611111111111,
    "lon": 15.082777777777778,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "15/33",
        "dimensionsMeters": "1445 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGH",
    "name": "HERRLJUNGA",
    "lat": 58.029444444444444,
    "lon": 13.108055555555556,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "18/36",
        "dimensionsMeters": "900 x 70",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESNH",
    "name": "HUDIKSVALL",
    "lat": 61.76833333333333,
    "lon": 17.080555555555556,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "1320 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESSF",
    "name": "HULTSFRED-VIMMERBY",
    "lat": 57.52583333333333,
    "lon": 15.823333333333332,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "1945 x 40",
        "surface": "CONC"
      }
    ]
  },
  {
    "icao": "ESVH",
    "name": "HÄLLEFORS",
    "lat": 59.8675,
    "lon": 14.42361111111111,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "18/36",
        "dimensionsMeters": "720 x 15",
        "surface": "GRAVEL"
      }
    ]
  },
  {
    "icao": "ESUH",
    "name": "HÄRNÖSAND/MYRAN",
    "lat": 62.63361111111111,
    "lon": 17.981388888888887,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "10/28",
        "dimensionsMeters": "800 x 23",
        "surface": "GRAVEL"
      }
    ]
  },
  {
    "icao": "ESFA",
    "name": "HÄSSLEHOLM/BOKEBERG",
    "lat": 56.13361111111111,
    "lon": 13.87888888888889,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "04/22",
        "dimensionsMeters": "830 x 40",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESMH",
    "name": "HÖGANÄS",
    "lat": 56.18472222222222,
    "lon": 12.575833333333334,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "14/32",
        "dimensionsMeters": "800 x 50",
        "surface": "GRASS"
      },
      {
        "designator": "06/24",
        "dimensionsMeters": "460 x 50",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESUE",
    "name": "IDRE",
    "lat": 61.86972222222222,
    "lon": 12.689444444444444,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "15/33",
        "dimensionsMeters": "1558 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESNJ",
    "name": "JOKKMOKK",
    "lat": 66.49666666666667,
    "lon": 20.1475,
    "category": "MIL, non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "14/32",
        "dimensionsMeters": "2000 x 25",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGJ",
    "name": "JÖNKÖPING",
    "lat": 57.75833333333333,
    "lon": 14.069166666666666,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "2203 x 45",
        "surface": "ASPH"
      },
      {
        "designator": "11/29",
        "dimensionsMeters": "525 x 25",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESMQ",
    "name": "KALMAR",
    "lat": 56.68555555555555,
    "lon": 16.2875,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "16/34",
        "dimensionsMeters": "2050 x 45",
        "surface": "ASPH"
      },
      {
        "designator": "05/23",
        "dimensionsMeters": "656 x 40",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESIA",
    "name": "KARLSBORG",
    "lat": 58.51361111111111,
    "lon": 14.507222222222222,
    "category": "MIL, non-licensed AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "06/24",
        "dimensionsMeters": "2289 x 40",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESKK",
    "name": "KARLSKOGA",
    "lat": 59.34444444444445,
    "lon": 14.49472222222222,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "1499 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESOK",
    "name": "KARLSTAD",
    "lat": 59.44472222222222,
    "lon": 13.3375,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "2516 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESVK",
    "name": "KATRINEHOLM",
    "lat": 59.02222222222222,
    "lon": 16.220277777777778,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "15/33",
        "dimensionsMeters": "700 x 40",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESNQ",
    "name": "KIRUNA",
    "lat": 67.82138888888889,
    "lon": 20.335555555555555,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "2502 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESNK",
    "name": "KRAMFORS-SOLLEFTEÅ",
    "lat": 63.04861111111111,
    "lon": 17.76888888888889,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "17/35",
        "dimensionsMeters": "2001 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESMK",
    "name": "KRISTIANSTAD",
    "lat": 55.92055555555555,
    "lon": 14.085277777777778,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "2215 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESMJ",
    "name": "KÅGERÖD",
    "lat": 55.995,
    "lon": 13.053333333333335,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "11/29",
        "dimensionsMeters": "800 x 35",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESVQ",
    "name": "KÖPING",
    "lat": 59.527499999999996,
    "lon": 15.969722222222222,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "07/25",
        "dimensionsMeters": "700 x 50",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESML",
    "name": "LANDSKRONA",
    "lat": 55.94444444444444,
    "lon": 12.869444444444445,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "12R/30L",
        "dimensionsMeters": "1180 x 30",
        "surface": "ASPH"
      },
      {
        "designator": "12L/30R",
        "dimensionsMeters": "1050 x 90",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESGL",
    "name": "LIDKÖPING",
    "lat": 58.46527777777778,
    "lon": 13.174444444444443,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "06/24",
        "dimensionsMeters": "1990 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESCF",
    "name": "LINKÖPING/MALMEN",
    "lat": 58.39611111111111,
    "lon": 15.521944444444445,
    "category": "MIL, licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "2214 x 35",
        "surface": "ASPH"
      },
      {
        "designator": "08/26",
        "dimensionsMeters": "1870 x 37",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESSL",
    "name": "LINKÖPING/SAAB",
    "lat": 58.406388888888884,
    "lon": 15.679722222222221,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "11/29",
        "dimensionsMeters": "2135 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESMG",
    "name": "LJUNGBY/FERINGE",
    "lat": 56.95027777777778,
    "lon": 13.921666666666667,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "1150 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESTL",
    "name": "LJUNGBYHED",
    "lat": 56.08527777777778,
    "lon": 13.206944444444444,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "11L/29R",
        "dimensionsMeters": "1998 x 40",
        "surface": "ASPH"
      },
      {
        "designator": "11R/29L",
        "dimensionsMeters": "1986 x 40",
        "surface": "CONC/ASPH"
      }
    ]
  },
  {
    "icao": "ESUL",
    "name": "LJUSDAL",
    "lat": 61.816944444444445,
    "lon": 16.004166666666666,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "09/27",
        "dimensionsMeters": "620 x 35",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESSG",
    "name": "LUDVIKA",
    "lat": 60.08833333333334,
    "lon": 15.096388888888889,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "819 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESPA",
    "name": "LULEÅ/KALLAX",
    "lat": 65.54333333333334,
    "lon": 22.12361111111111,
    "category": "MIL, licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "14/32",
        "dimensionsMeters": "3350 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESNL",
    "name": "LYCKSELE",
    "lat": 64.5475,
    "lon": 18.717777777777776,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "14/32",
        "dimensionsMeters": "2092 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESMS",
    "name": "MALMÖ",
    "lat": 55.54833333333333,
    "lon": 13.353333333333333,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "17/35",
        "dimensionsMeters": "2800 x 45",
        "surface": "ASPH"
      },
      {
        "designator": "11/29",
        "dimensionsMeters": "799 x 18",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESVM",
    "name": "MALUNG/SKINNLANDA",
    "lat": 60.65888888888889,
    "lon": 13.726666666666667,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "16/34",
        "dimensionsMeters": "800 x 23",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESUI",
    "name": "MELLANSEL",
    "lat": 63.39194444444444,
    "lon": 18.320555555555554,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "09/27",
        "dimensionsMeters": "795 x 35",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESUM",
    "name": "MOHED",
    "lat": 61.29111111111111,
    "lon": 16.84638888888889,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "800 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESKM",
    "name": "MORA/SILJAN",
    "lat": 60.95861111111111,
    "lon": 14.510555555555555,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "16/34",
        "dimensionsMeters": "1814 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESKO",
    "name": "MUNKFORS",
    "lat": 59.79888888888889,
    "lon": 13.490555555555554,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "700 x 40",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESSP",
    "name": "NORRKÖPING/KUNGSÄNGEN",
    "lat": 58.586111111111116,
    "lon": 16.24638888888889,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "09/27",
        "dimensionsMeters": "2205 x 45",
        "surface": "ASPH"
      },
      {
        "designator": "11/29",
        "dimensionsMeters": "600 x 35",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESSN",
    "name": "NORRTÄLJE",
    "lat": 59.73277777777778,
    "lon": 18.69638888888889,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "07/25",
        "dimensionsMeters": "830 x 18",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESNM",
    "name": "OPTAND",
    "lat": 63.125277777777775,
    "lon": 14.808333333333334,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "18/36",
        "dimensionsMeters": "1000 x 18",
        "surface": "ASPH"
      },
      {
        "designator": "15/33",
        "dimensionsMeters": "750 x 40",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESNR",
    "name": "ORSA",
    "lat": 61.19222222222222,
    "lon": 14.719166666666666,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "1000 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESMO",
    "name": "OSKARSHAMN",
    "lat": 57.35194444444445,
    "lon": 16.498333333333335,
    "category": "Non-Licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "1504 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESUO",
    "name": "OVIKEN",
    "lat": 63.041666666666664,
    "lon": 14.001388888888888,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "18/36",
        "dimensionsMeters": "750 x 20",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESUP",
    "name": "PAJALA",
    "lat": 67.24583333333334,
    "lon": 23.06888888888889,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "11/29",
        "dimensionsMeters": "2300 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESNP",
    "name": "PITEÅ",
    "lat": 65.39833333333334,
    "lon": 21.260833333333334,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "16/34",
        "dimensionsMeters": "1000 x 25",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESUR",
    "name": "RAMSELE",
    "lat": 63.49027777777778,
    "lon": 16.483611111111113,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "14/32",
        "dimensionsMeters": "740 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESDF",
    "name": "RONNEBY",
    "lat": 56.266666666666666,
    "lon": 15.265,
    "category": "MIL, licensed instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "2331 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESFR",
    "name": "RÅDA",
    "lat": 58.49805555555556,
    "lon": 13.053055555555556,
    "category": "MIL, non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "18/36",
        "dimensionsMeters": "1987 x 35",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESFS",
    "name": "SANDVIK",
    "lat": 57.068333333333335,
    "lon": 16.86416666666667,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "17/35",
        "dimensionsMeters": "600 x 25",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESVS",
    "name": "SILJANSNÄS",
    "lat": 60.785,
    "lon": 14.827222222222222,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "14L/32R",
        "dimensionsMeters": "850 x 35",
        "surface": "GRASS"
      },
      {
        "designator": "14R/32L",
        "dimensionsMeters": "850 x 16",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESMI",
    "name": "SJÖBO SÖVDE",
    "lat": 55.598333333333336,
    "lon": 13.677222222222222,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "950 x 50",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESNS",
    "name": "SKELLEFTEÅ",
    "lat": 64.62472222222222,
    "lon": 21.076944444444443,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "10/28",
        "dimensionsMeters": "2520 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGR",
    "name": "SKÖVDE",
    "lat": 58.45611111111111,
    "lon": 13.972777777777777,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "1736 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESMY",
    "name": "SMÅLANDSSTENAR",
    "lat": 57.16861111111111,
    "lon": 13.44,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "04/22",
        "dimensionsMeters": "915 x 15",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESNB",
    "name": "SOLLEFTEÅ",
    "lat": 63.17111111111111,
    "lon": 16.985555555555557,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "14/32",
        "dimensionsMeters": "820 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESVE",
    "name": "STEGEBORG",
    "lat": 58.43333333333333,
    "lon": 16.605,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "08/26",
        "dimensionsMeters": "800 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESSA",
    "name": "STOCKHOLM/ARLANDA",
    "lat": 59.651944444444446,
    "lon": 17.91861111111111,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "01L/19R",
        "dimensionsMeters": "3301 x 45",
        "surface": "ASPH"
      },
      {
        "designator": "01R/19L",
        "dimensionsMeters": "2500 x 45",
        "surface": "ASPH"
      },
      {
        "designator": "08/26",
        "dimensionsMeters": "2500 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESSB",
    "name": "STOCKHOLM/BROMMA",
    "lat": 59.35444444444445,
    "lon": 17.942222222222224,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "1668 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESKN",
    "name": "STOCKHOLM/SKAVSTA",
    "lat": 58.78861111111111,
    "lon": 16.90361111111111,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "08/26",
        "dimensionsMeters": "2878 x 45",
        "surface": "ASPH"
      },
      {
        "designator": "16/34",
        "dimensionsMeters": "2043 x 40",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESSE",
    "name": "STOCKHOLM/SKÅ-EDEBY",
    "lat": 59.345,
    "lon": 17.740555555555556,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "11/29",
        "dimensionsMeters": "800 x 50",
        "surface": "GRASS"
      },
      {
        "designator": "03/21",
        "dimensionsMeters": "650 x 65",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESOW",
    "name": "STOCKHOLM/VÄSTERÅS",
    "lat": 59.589444444444446,
    "lon": 16.63361111111111,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "2581 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESUD",
    "name": "STORUMAN",
    "lat": 64.96083333333334,
    "lon": 17.696666666666665,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "15/33",
        "dimensionsMeters": "2283 x 40",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESOL",
    "name": "STORVIK/LEMSTANÄS",
    "lat": 60.58777777777778,
    "lon": 16.586666666666666,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "06/24",
        "dimensionsMeters": "620 x 23",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGS",
    "name": "STRÖMSTAD/NÄSINGE",
    "lat": 59.01694444444444,
    "lon": 11.343611111111112,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "900 x 53",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESKC",
    "name": "SUNDBRO",
    "lat": 59.922777777777775,
    "lon": 17.53666666666667,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "630 x 40",
        "surface": "GRASS"
      },
      {
        "designator": "08/26",
        "dimensionsMeters": "470 x 60",
        "surface": "GRASS"
      },
      {
        "designator": "14/32",
        "dimensionsMeters": "435 x 35",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESNN",
    "name": "SUNDSVALL-TIMRÅ",
    "lat": 62.529444444444444,
    "lon": 17.442777777777778,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "16/34",
        "dimensionsMeters": "1954 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESKU",
    "name": "SUNNE",
    "lat": 59.86027777777778,
    "lon": 13.112777777777778,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "770 x 100",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESND",
    "name": "SVEG",
    "lat": 62.047777777777775,
    "lon": 14.424166666666666,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "09/27",
        "dimensionsMeters": "1701 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESIB",
    "name": "SÅTENÄS",
    "lat": 58.42833333333333,
    "lon": 12.71111111111111,
    "category": "MIL, licensed, instument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "2264 x 45",
        "surface": "ASPH"
      },
      {
        "designator": "11/29",
        "dimensionsMeters": "1933 x 40",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGY",
    "name": "SÄFFLE",
    "lat": 59.09111111111111,
    "lon": 12.958333333333332,
    "category": "Licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "690 x 50",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESKS",
    "name": "SÄLEN/SCANDINAVIAN MOUNTAINS",
    "lat": 61.164722222222224,
    "lon": 12.83388888888889,
    "category": "Licensed instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "15/33",
        "dimensionsMeters": "2500 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESNY",
    "name": "SÖDERHAMN",
    "lat": 61.26138888888889,
    "lon": 17.098333333333333,
    "category": "Non-licenced AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "2524 x 40",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGD",
    "name": "TIDAHOLM/BÄMMELSHED",
    "lat": 58.19194444444444,
    "lon": 13.995555555555555,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "04/22",
        "dimensionsMeters": "675 x 50",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESKT",
    "name": "TIERP",
    "lat": 60.345,
    "lon": 17.421944444444446,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "16/34",
        "dimensionsMeters": "850 x 35",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESST",
    "name": "TORSBY",
    "lat": 60.15472222222222,
    "lon": 12.993611111111111,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "16/34",
        "dimensionsMeters": "1590 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGA",
    "name": "UDDEVALLA/BACKAMO",
    "lat": 58.17722222222222,
    "lon": 11.973611111111111,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "06/24",
        "dimensionsMeters": "760 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESGU",
    "name": "UDDEVALLA/RÖRKÄRR",
    "lat": 58.367777777777775,
    "lon": 11.775277777777779,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "655 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESNU",
    "name": "UMEÅ",
    "lat": 63.793055555555554,
    "lon": 20.279999999999998,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "14/32",
        "dimensionsMeters": "2302 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESCM",
    "name": "UPPSALA",
    "lat": 59.900277777777774,
    "lon": 17.592499999999998,
    "category": "MIL, non-licensed AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "08/26",
        "dimensionsMeters": "1963 x 40",
        "surface": "ASPH"
      },
      {
        "designator": "03/21",
        "dimensionsMeters": "1906 x 40",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGV",
    "name": "VARBERG",
    "lat": 57.124722222222225,
    "lon": 12.228055555555555,
    "category": "Licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "06/24",
        "dimensionsMeters": "600 x 22",
        "surface": "GRASS"
      },
      {
        "designator": "12/30",
        "dimensionsMeters": "560 x 40",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESTT",
    "name": "VELLINGE",
    "lat": 55.39611111111111,
    "lon": 13.025277777777779,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "730 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESPE",
    "name": "VIDSEL",
    "lat": 65.87527777777777,
    "lon": 20.15,
    "category": "MIL, non-licensed AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "11/29",
        "dimensionsMeters": "2234 x 35",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESNV",
    "name": "VILHELMINA",
    "lat": 64.5786111111111,
    "lon": 16.83972222222222,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "10/28",
        "dimensionsMeters": "1500 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESSV",
    "name": "VISBY",
    "lat": 57.66277777777778,
    "lon": 18.34611111111111,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "2000 x 45",
        "surface": "ASPH"
      },
      {
        "designator": "10/28",
        "dimensionsMeters": "1100 x 40",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESSI",
    "name": "VISINGSÖ",
    "lat": 58.09861111111111,
    "lon": 14.4025,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "15/33",
        "dimensionsMeters": "800 x 25",
        "surface": "GRASS"
      },
      {
        "designator": "01/19",
        "dimensionsMeters": "600 x 25",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESGO",
    "name": "VÅRGÅRDA",
    "lat": 58.03916666666667,
    "lon": 12.785833333333333,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "04/22",
        "dimensionsMeters": "890 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESSW",
    "name": "VÄSTERVIK",
    "lat": 57.78,
    "lon": 16.52361111111111,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "15/33",
        "dimensionsMeters": "1199 x 30",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESSX",
    "name": "VÄSTERÅS/JOHANNISBERG",
    "lat": 59.575833333333335,
    "lon": 16.503055555555555,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "05/23",
        "dimensionsMeters": "850 x 23",
        "surface": "ASPH"
      },
      {
        "designator": "16/34",
        "dimensionsMeters": "730 x 50",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESMX",
    "name": "VÄXJÖ/KRONOBERG",
    "lat": 56.930277777777775,
    "lon": 14.72888888888889,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "2106 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGC",
    "name": "ÅLLEBERG",
    "lat": 58.13472222222222,
    "lon": 13.6025,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "680 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESUJ",
    "name": "ÅNGE/TÄLJE",
    "lat": 62.56527777777777,
    "lon": 15.834722222222222,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "14/32",
        "dimensionsMeters": "838 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESNZ",
    "name": "ÅRE ÖSTERSUND",
    "lat": 63.19444444444444,
    "lon": 14.500277777777777,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "2500 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESNF",
    "name": "ÅVIKEN/ÅVIKEN FLY CAMP",
    "lat": 63.21277777777778,
    "lon": 18.749166666666667,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "600 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESMU",
    "name": "ÄLMHULT/MÖCKELN",
    "lat": 56.57055555555556,
    "lon": 14.16638888888889,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "03/21",
        "dimensionsMeters": "604 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESUV",
    "name": "ÄLVSBYN",
    "lat": 65.64583333333334,
    "lon": 21.06138888888889,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "04/22",
        "dimensionsMeters": "730 x 30",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESTA",
    "name": "ÄNGELHOLM",
    "lat": 56.29111111111111,
    "lon": 12.855,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "14/32",
        "dimensionsMeters": "1945 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESMZ",
    "name": "ÖLANDA",
    "lat": 57.328611111111115,
    "lon": 17.05027777777778,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "15/33",
        "dimensionsMeters": "600 x 23",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESOE",
    "name": "ÖREBRO",
    "lat": 59.22805555555556,
    "lon": 15.04,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "01/19",
        "dimensionsMeters": "3270 x 45",
        "surface": "ASPH"
      }
    ]
  },
  {
    "icao": "ESGM",
    "name": "ÖRESTEN",
    "lat": 57.445277777777775,
    "lon": 12.648888888888889,
    "category": "Non-licensed AD",
    "detailsInAd2": false,
    "runways": [
      {
        "designator": "06/24",
        "dimensionsMeters": "680 x 35",
        "surface": "GRASS"
      }
    ]
  },
  {
    "icao": "ESNO",
    "name": "ÖRNSKÖLDSVIK",
    "lat": 63.407777777777774,
    "lon": 18.9925,
    "category": "Licensed, instrument AD",
    "detailsInAd2": true,
    "runways": [
      {
        "designator": "12/30",
        "dimensionsMeters": "2016 x 45",
        "surface": "ASPH"
      }
    ]
  }
]
