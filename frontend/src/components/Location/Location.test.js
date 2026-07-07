import React from "react";
import { shallow } from "enzyme";
import Location from "./Location";

describe("Location", () => {
  test("matches snapshot", () => {
    const wrapper = shallow(<Location />);
    expect(wrapper).toMatchSnapshot();
  });
});
