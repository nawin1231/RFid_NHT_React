import React from "react";
import { shallow } from "enzyme";
import Washing from "./Washing";

describe("Washing", () => {
  test("matches snapshot", () => {
    const wrapper = shallow(<Washing />);
    expect(wrapper).toMatchSnapshot();
  });
});
