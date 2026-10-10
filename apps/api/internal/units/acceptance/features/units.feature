Feature: Unit master
  Quotation lines, the catalog and Coretax exports share one unit list,
  and every unit carries the Coretax code the e-faktur needs.

  Scenario: The unit list is complete, ordered and Coretax ready
    When the user lists units
    Then the response status is 200
    And the total count header equals the number of units
    And the units are ordered by id
    And every unit has a name and a Coretax code
    And unit "KG" is "Kilogram" with Coretax code "UM.0003"
    And unit "PCS" is listed

  Scenario: Units carry the other ways people write them
    When the user lists units
    Then unit "TIN" is "Tin" with Coretax code "UM.0033"
    And unit "PAIL" is "Pail" with Coretax code "UM.0033"
    And unit "DRUM" is "Drum" with Coretax code "UM.0033"
    And unit "PCS" is also written "PIECES"
    And unit "TIN" is also written "CAN"
    And unit "LBR" is also written "SHEET"
    And unit "PKT" is also written "PACK"
    And unit "PACK" is not listed
    And no alias equals a unit code
