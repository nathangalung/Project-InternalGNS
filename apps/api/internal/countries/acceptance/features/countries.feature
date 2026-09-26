Feature: Country master
  Every form that asks for a country or a phone prefix reads one list,
  sorted by name so the picker reads alphabetically.

  Scenario: The country list is complete and sorted by name
    When the user lists countries
    Then the response status is 200
    And the total count header equals the number of countries
    And the countries are sorted by name
    And country "IDN" is "Indonesia" with dial code "+62"
    And country "SGP" is "Singapore" with dial code "+65"
